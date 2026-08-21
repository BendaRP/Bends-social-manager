import { PostStatus, TargetStatus, Visibility, type PostFormat } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./auth";
import { cancelPublish, schedulePublish } from "@/worker/queues";
import { getAdapter } from "@/platforms";
import { validatePost, type ValidationIssue } from "./validation";
import type { MediaInput } from "@/platforms/types";

/**
 * Post lifecycle: create, approve, schedule, cancel.
 *
 * Enqueueing for publication happens only in `approvePost`. Keeping that in one
 * place is what makes the approval requirement enforceable — there is no other
 * code path that can put a job on the publish queue.
 */

export interface CreatePostInput {
  userId: string;
  title?: string;
  format: PostFormat;
  caption: string;
  hashtags: string[];
  contentPillar?: string;
  mediaIds: string[];
  scheduledAt: Date | null;
  targets: Array<{
    accountId: string;
    captionOverride?: string;
    hashtagsOverride?: string[];
    scheduledAt?: Date | null;
    requestedVisibility?: Visibility;
  }>;
}

export async function createPost(input: CreatePostInput) {
  if (input.targets.length === 0) {
    throw new Error("A post needs at least one destination account");
  }

  return prisma.post.create({
    data: {
      title: input.title ?? null,
      format: input.format,
      caption: input.caption,
      hashtags: input.hashtags,
      contentPillar: input.contentPillar ?? null,
      scheduledAt: input.scheduledAt,
      createdById: input.userId,
      // New posts always start awaiting sign-off; they are never created in an
      // approved state, whatever the caller asks for.
      status: PostStatus.PENDING_APPROVAL,
      media: {
        create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })),
      },
      targets: {
        create: input.targets.map((target) => ({
          accountId: target.accountId,
          captionOverride: target.captionOverride ?? null,
          hashtagsOverride: target.hashtagsOverride ?? [],
          scheduledAt: target.scheduledAt ?? input.scheduledAt,
          requestedVisibility: target.requestedVisibility ?? Visibility.PUBLIC,
        })),
      },
    },
    include: { targets: { include: { account: true } }, media: { include: { media: true } } },
  });
}

/**
 * Records a human's approval and queues the post.
 *
 * The approver's identity and the timestamp are written in the same update that
 * moves the status, so an approved post always carries the evidence of who
 * approved it.
 */
export async function approvePost(postId: string, userId: string) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: true },
  });

  if (post.status === PostStatus.PUBLISHED) {
    throw new Error("This post has already been published");
  }

  const now = new Date();
  const scheduled = post.scheduledAt && post.scheduledAt > now;

  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      status: scheduled ? PostStatus.SCHEDULED : PostStatus.APPROVED,
      approvedById: userId,
      approvedAt: now,
      targets: { updateMany: { where: {}, data: { status: TargetStatus.QUEUED } } },
    },
    include: { targets: true },
  });

  for (const target of updated.targets) {
    await schedulePublish(target.id, target.scheduledAt ?? post.scheduledAt);
  }

  await audit(userId, "post.approved", "Post", postId, {
    scheduledAt: post.scheduledAt?.toISOString() ?? "immediate",
    targetCount: updated.targets.length,
  });

  return updated;
}

export async function cancelPost(postId: string, userId: string) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: true },
  });

  for (const target of post.targets) {
    await cancelPublish(target.id);
  }

  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      status: PostStatus.CANCELLED,
      // Clearing the approval matters: re-approving later must be a fresh,
      // deliberate decision rather than something the old record still permits.
      approvedById: null,
      approvedAt: null,
      targets: {
        updateMany: {
          where: { status: { not: TargetStatus.PUBLISHED } },
          data: { status: TargetStatus.SKIPPED },
        },
      },
    },
  });

  await audit(userId, "post.cancelled", "Post", postId);
  return updated;
}

/** Runs each destination's rules over a draft, for the composer to display. */
export async function validatePostForTargets(input: {
  format: PostFormat;
  caption: string;
  hashtags: string[];
  mediaIds: string[];
  accountIds: string[];
}): Promise<ValidationIssue[]> {
  const [accounts, media] = await Promise.all([
    prisma.socialAccount.findMany({ where: { id: { in: input.accountIds } } }),
    prisma.mediaAsset.findMany({ where: { id: { in: input.mediaIds } } }),
  ]);

  // Preserve the order the user arranged, which is the carousel slide order.
  const ordered = input.mediaIds
    .map((id) => media.find((m) => m.id === id))
    .filter((m): m is (typeof media)[number] => Boolean(m));

  const mediaInputs: MediaInput[] = ordered.map((m) => ({
    type: m.type,
    url: m.publicUrl,
    mimeType: m.mimeType,
    width: m.width,
    height: m.height,
    durationSec: m.durationSec,
    sizeBytes: m.sizeBytes,
  }));

  return accounts.flatMap((account) => {
    const adapter = getAdapter(account.platform, { isAudited: account.isAudited });
    return validatePost({
      platform: account.platform,
      format: input.format,
      caption: input.caption,
      hashtags: input.hashtags,
      media: mediaInputs,
      constraints: adapter.mediaConstraints(input.format),
      supportedFormats: adapter.supportedFormats,
    });
  });
}
