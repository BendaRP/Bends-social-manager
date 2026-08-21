import {
  AccountStatus,
  PostStatus,
  TargetStatus,
  Visibility,
  type Platform,
  type PostFormat,
} from "@prisma/client";
import { prisma } from "./db";
import { getAdapter } from "@/platforms";
import { PlatformError, type MediaInput, type PublishRequest } from "@/platforms/types";
import { ensureFreshTokens, toIdentity } from "./accounts";
import {
  checkRateLimit,
  recordPublish,
  secondsSinceLastPublish,
  MIN_SECONDS_BETWEEN_POSTS,
} from "./rate-limit";
import { hasBlockingIssues, validatePost } from "./validation";
import { buildPostFeatures } from "@/lib/features";
import { redactSecrets } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { verifyPubliclyReachable } from "./storage";

/**
 * Publishing a single post target.
 *
 * This function is the only path to the outside world. Anything that wants to
 * publish — the scheduler, a "publish now" button, a retry — comes through
 * here, which is what makes the approval gate below meaningful.
 */

export class ApprovalRequiredError extends Error {
  constructor(postId: string, status: PostStatus) {
    super(
      `Refusing to publish post ${postId}: status is ${status}, not APPROVED. ` +
        `Every post must be explicitly approved before it can go out.`,
    );
    this.name = "ApprovalRequiredError";
  }
}

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number, message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export interface PublishOutcome {
  targetId: string;
  externalPostId: string;
  permalink?: string;
  effectiveVisibility: Visibility;
  warnings: string[];
}

export async function publishTarget(targetId: string): Promise<PublishOutcome> {
  const target = await prisma.postTarget.findUniqueOrThrow({
    where: { id: targetId },
    include: {
      account: true,
      post: { include: { media: { include: { media: true }, orderBy: { position: "asc" } } } },
    },
  });

  const { post, account } = target;

  // ---------------------------------------------------------------------
  // Idempotency, checked first.
  //
  // BullMQ can deliver a job more than once — a worker restart mid-job is the
  // common case — and a duplicate publish is not something we can take back:
  // it is a second real post on a real business account.
  //
  // This has to sit ahead of the approval gate rather than after it. Once a
  // target has published, its parent post is already marked PUBLISHED, which
  // is not an "approved" status; checking approval first would reject the
  // redelivered job with "this post was never approved" — alarming, wrong, and
  // it would leave a permanently-failed job behind for a post that in fact went
  // out correctly.
  //
  // Short-circuiting here does not weaken the gate: TargetStatus.PUBLISHED is
  // only ever written by a publish that already passed it.
  // ---------------------------------------------------------------------
  if (target.status === TargetStatus.PUBLISHED) {
    return {
      targetId: target.id,
      externalPostId: target.externalPostId ?? "",
      permalink: target.permalink ?? undefined,
      effectiveVisibility: target.effectiveVisibility ?? Visibility.PUBLIC,
      warnings: [],
    };
  }

  // ---------------------------------------------------------------------
  // The approval gate.
  //
  // A code-level check, not a UI affordance. There is no flag on the job, no
  // admin override, and no "force" parameter that reaches past it — the only
  // way to publish is for a human to have moved the post to APPROVED, which
  // records who did it and when.
  // ---------------------------------------------------------------------
  const approvalRequired = getEnv().REQUIRE_MANUAL_APPROVAL;
  const approvedStatuses: PostStatus[] = [
    PostStatus.APPROVED,
    PostStatus.SCHEDULED,
    PostStatus.PUBLISHING,
    // A post that reached some networks but not others is still mid-flight for
    // the ones that failed; retrying those must not require re-approval.
    PostStatus.PARTIALLY_PUBLISHED,
  ];

  if (approvalRequired) {
    if (!approvedStatuses.includes(post.status)) {
      throw new ApprovalRequiredError(post.id, post.status);
    }
    // A status alone is not proof of sign-off — a row edited directly in the
    // database would have one. Require the recorded approver too.
    if (!post.approvedById || !post.approvedAt) {
      throw new ApprovalRequiredError(post.id, post.status);
    }
  }

  if (account.status === AccountStatus.REVOKED) {
    throw new PlatformError(
      `The ${account.platform} connection was revoked; reconnect the account`,
      { platform: account.platform, code: "ACCOUNT_REVOKED", retryable: false },
    );
  }

  const adapter = getAdapter(account.platform, { isAudited: account.isAudited });
  const tokens = await ensureFreshTokens(account);
  const identity = toIdentity(account);

  const format = (target.formatOverride ?? post.format) as PostFormat;
  const caption = target.captionOverride ?? post.caption;
  const hashtags =
    target.hashtagsOverride.length > 0 ? target.hashtagsOverride : post.hashtags;

  const media: MediaInput[] = post.media.map((entry) => ({
    type: entry.media.type,
    url: entry.media.publicUrl,
    mimeType: entry.media.mimeType,
    width: entry.media.width,
    height: entry.media.height,
    durationSec: entry.media.durationSec,
    sizeBytes: entry.media.sizeBytes,
  }));

  // --- Validate before spending a rate-limit slot -------------------------
  const issues = validatePost({
    platform: account.platform,
    format,
    caption,
    hashtags,
    media,
    constraints: adapter.mediaConstraints(format),
    supportedFormats: adapter.supportedFormats,
  });

  if (hasBlockingIssues(issues)) {
    const summary = issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.field}: ${i.message}`)
      .join("; ");
    throw new PlatformError(`Post fails ${account.platform} requirements — ${summary}`, {
      platform: account.platform,
      code: "VALIDATION_FAILED",
      retryable: false,
      raw: issues,
    });
  }

  // The platforms fetch media themselves. A bucket that is readable from the
  // browser but not anonymously produces a confusing platform-side error, so
  // check reachability here where the message can be specific.
  const firstMedia = media[0];
  if (firstMedia) {
    const reachability = await verifyPubliclyReachable(firstMedia.url);
    if (!reachability.reachable) {
      throw new PlatformError(
        `Media is not publicly reachable — ${reachability.reason ?? "unknown reason"}`,
        {
          platform: account.platform,
          code: "MEDIA_UNREACHABLE",
          retryable: false,
          raw: reachability,
        },
      );
    }
  }

  await enforceRateLimits(account.platform, account.id, adapter, tokens, identity);

  // --- Publish ------------------------------------------------------------
  const attemptNumber =
    (await prisma.publishAttempt.count({ where: { targetId: target.id } })) + 1;

  const attempt = await prisma.publishAttempt.create({
    data: { targetId: target.id, attemptNumber },
  });

  await prisma.postTarget.update({
    where: { id: target.id },
    data: { status: TargetStatus.PUBLISHING },
  });

  const request: PublishRequest = {
    format,
    caption,
    hashtags,
    media,
    requestedVisibility: target.requestedVisibility,
    idempotencyKey: `${target.id}:${attemptNumber}`,
  };

  try {
    const result = await adapter.publish(tokens, identity, request);
    const publishedAt = new Date();

    await recordPublish(account.platform, account.id, 86_400);

    // Metrics and features are written in one transaction with the target
    // update: a published post that failed to record its feature row would be
    // invisible to the recommendation engine forever.
    await prisma.$transaction(async (tx) => {
      await tx.postTarget.update({
        where: { id: target.id },
        data: {
          status: TargetStatus.PUBLISHED,
          externalPostId: result.externalPostId,
          externalMediaId: result.externalMediaId ?? null,
          permalink: result.permalink ?? null,
          effectiveVisibility: result.effectiveVisibility,
          publishedAt,
          lastError: null,
        },
      });

      await tx.publishAttempt.update({
        where: { id: attempt.id },
        data: {
          succeeded: true,
          finishedAt: new Date(),
          debugPayload: redactSecrets({ result }) as object,
        },
      });

      const accountMetrics = await prisma.accountMetricSnapshot
        .findFirst({
          where: { accountId: account.id },
          orderBy: { capturedAt: "desc" },
        })
        .catch(() => null);

      const videoMedia = post.media.find((m) => m.media.type === "VIDEO");

      await tx.postFeatures.create({
        data: {
          targetId: target.id,
          ...buildPostFeatures({
            platform: account.platform,
            format,
            publishedAt,
            caption,
            hashtags,
            mediaCount: media.length,
            videoDurationSec: videoMedia?.media.durationSec ?? null,
            aspectRatio: post.media[0]?.media.aspectRatio ?? null,
            contentPillar: post.contentPillar,
            followerCountAtPublish: accountMetrics?.followerCount ?? null,
          }),
        },
      });
    });

    await refreshPostStatus(post.id);

    return {
      targetId: target.id,
      externalPostId: result.externalPostId,
      permalink: result.permalink,
      effectiveVisibility: result.effectiveVisibility,
      warnings: result.warnings,
    };
  } catch (error) {
    const platformError = error instanceof PlatformError ? error : null;

    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: {
        succeeded: false,
        finishedAt: new Date(),
        errorCode: platformError?.options.code ?? null,
        errorMessage: (error as Error).message,
        debugPayload: redactSecrets({ raw: platformError?.options.raw }) as object,
      },
    });

    await prisma.postTarget.update({
      where: { id: target.id },
      data: { status: TargetStatus.FAILED, lastError: (error as Error).message },
    });

    await refreshPostStatus(post.id);
    throw error;
  }
}

/**
 * Two independent limits, both checked before publishing:
 *
 *  - the platform's own quota, read live from the account
 *  - our own minimum spacing between posts
 */
async function enforceRateLimits(
  platform: Platform,
  accountId: string,
  adapter: ReturnType<typeof getAdapter>,
  tokens: Awaited<ReturnType<typeof ensureFreshTokens>>,
  identity: ReturnType<typeof toIdentity>,
): Promise<void> {
  const quota = await adapter.fetchPublishingQuota(tokens, identity);

  await prisma.platformLimitSnapshot.create({
    data: {
      accountId,
      quotaUsage: quota.used,
      quotaTotal: quota.total,
      windowSeconds: quota.windowSeconds,
      raw: redactSecrets({ quota }) as object,
    },
  });

  // Trust the platform's own numbers when it gives them.
  if (quota.total !== null && quota.used !== null && quota.used >= quota.total) {
    throw new RateLimitedError(
      quota.windowSeconds,
      `${platform} reports ${quota.used}/${quota.total} posts used in the current ` +
        `${Math.round(quota.windowSeconds / 3600)}h window`,
    );
  }
  if (quota.total === 0) {
    throw new RateLimitedError(
      3600,
      `${platform} reports this account cannot post right now`,
    );
  }

  const decision = await checkRateLimit(
    platform,
    accountId,
    quota.total ?? 25,
    quota.windowSeconds,
  );
  if (!decision.allowed) {
    throw new RateLimitedError(
      decision.retryAfterSeconds ?? 3600,
      `Local rate limit reached for ${platform}: ${decision.used}/${decision.limit} ` +
        `in the last ${Math.round(quota.windowSeconds / 3600)}h`,
    );
  }

  const sinceLast = await secondsSinceLastPublish(platform, accountId);
  if (sinceLast !== null && sinceLast < MIN_SECONDS_BETWEEN_POSTS) {
    throw new RateLimitedError(
      MIN_SECONDS_BETWEEN_POSTS - sinceLast,
      `Only ${Math.round(sinceLast / 60)} minutes since the last ${platform} post; ` +
        `posts are spaced at least ${MIN_SECONDS_BETWEEN_POSTS / 60} minutes apart`,
    );
  }
}

/** Rolls per-target outcomes up into the parent post's status. */
export async function refreshPostStatus(postId: string): Promise<void> {
  const targets = await prisma.postTarget.findMany({
    where: { postId },
    select: { status: true, publishedAt: true },
  });

  if (targets.length === 0) return;

  const published = targets.filter((t) => t.status === TargetStatus.PUBLISHED);
  const failed = targets.filter((t) => t.status === TargetStatus.FAILED);
  const pending = targets.filter(
    (t) => t.status === TargetStatus.PENDING || t.status === TargetStatus.QUEUED,
  );

  let status: PostStatus;
  if (published.length === targets.length) {
    status = PostStatus.PUBLISHED;
  } else if (published.length > 0 && pending.length === 0) {
    // Some networks took it, others rejected it. Distinct from FAILED because
    // retrying must not republish the ones that already succeeded.
    status = PostStatus.PARTIALLY_PUBLISHED;
  } else if (failed.length === targets.length) {
    status = PostStatus.FAILED;
  } else {
    return; // Still in flight; leave the current status alone.
  }

  const publishedAt = published
    .map((t) => t.publishedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  await prisma.post.update({
    where: { id: postId },
    data: { status, publishedAt: publishedAt ?? undefined },
  });
}
