import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { Platform, PostFormat, PostStatus, TargetStatus, Visibility } from "@prisma/client";
import { prisma } from "@/server/db";
import { encrypt } from "@/lib/crypto";
import { ApprovalRequiredError, publishTarget } from "@/server/publish";

/**
 * The approval gate is the safety property the whole system rests on: nothing
 * reaches a real business account without a human having signed off on it.
 *
 * These tests run against a real database and assert that the refusal happens
 * before any network call, so a bug in an adapter cannot turn into an
 * unapproved post going live.
 */

const publishSpy = vi.fn();

vi.mock("@/platforms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platforms")>();
  return {
    ...actual,
    getAdapter: () => ({
      platform: Platform.INSTAGRAM,
      supportedFormats: [PostFormat.SINGLE_IMAGE, PostFormat.CAROUSEL],
      publish: publishSpy,
      mediaConstraints: () => ({
        image: {
          maxSizeBytes: 8 * 1024 * 1024,
          minAspectRatio: 0.8,
          maxAspectRatio: 1.91,
          allowedMimeTypes: ["image/jpeg"],
        },
        maxCaptionLength: 2200,
        maxHashtags: 30,
      }),
      fetchPublishingQuota: async () => ({
        used: 0,
        total: 25,
        windowSeconds: 86_400,
        source: "live" as const,
      }),
      refreshTokens: async () => null,
      fetchPostMetrics: async () => ({}),
      fetchAccountMetrics: async () => ({}),
      buildAuthorizationUrl: () => "",
      exchangeCode: async () => [],
    }),
  };
});

// Media reachability is a network check; the gate must be reached without it.
vi.mock("@/server/storage", () => ({
  verifyPubliclyReachable: async () => ({ reachable: true, status: 200 }),
}));

async function seed(status: PostStatus, approved: boolean) {
  const suffix = Math.random().toString(36).slice(2, 8);

  const user = await prisma.user.create({
    data: { email: `owner-${suffix}@example.com`, passwordHash: "x" },
  });

  const account = await prisma.socialAccount.create({
    data: {
      platform: Platform.INSTAGRAM,
      externalId: `ig-${suffix}`,
      username: "test_account",
      accessTokenCipher: encrypt("fake-token").cipher,
      scopes: ["instagram_content_publish"],
    },
  });

  const media = await prisma.mediaAsset.create({
    data: {
      type: "IMAGE",
      storageKey: `media/${suffix}.jpg`,
      publicUrl: "https://media.example.com/a.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 500_000,
      width: 1080,
      height: 1080,
      aspectRatio: 1,
    },
  });

  const post = await prisma.post.create({
    data: {
      format: PostFormat.SINGLE_IMAGE,
      caption: "בדיקה",
      status,
      createdById: user.id,
      approvedById: approved ? user.id : null,
      approvedAt: approved ? new Date() : null,
      media: { create: { mediaId: media.id, position: 0 } },
    },
  });

  const target = await prisma.postTarget.create({
    data: {
      postId: post.id,
      accountId: account.id,
      status: TargetStatus.QUEUED,
      requestedVisibility: Visibility.PUBLIC,
    },
  });

  return { target, post, account, user, media };
}

beforeEach(async () => {
  publishSpy.mockReset();
  publishSpy.mockResolvedValue({
    externalPostId: "ig-post-1",
    permalink: "https://instagram.com/p/abc",
    effectiveVisibility: Visibility.PUBLIC,
    warnings: [],
  });

  // Order matters: dependent rows first.
  await prisma.publishAttempt.deleteMany();
  await prisma.postFeatures.deleteMany();
  await prisma.metricSnapshot.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.postMedia.deleteMany();
  await prisma.post.deleteMany();
  await prisma.platformLimitSnapshot.deleteMany();
  await prisma.accountMetricSnapshot.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("manual approval gate", () => {
  it("refuses to publish a DRAFT post", async () => {
    const { target } = await seed(PostStatus.DRAFT, false);
    await expect(publishTarget(target.id)).rejects.toThrow(ApprovalRequiredError);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("refuses to publish a post awaiting approval", async () => {
    const { target } = await seed(PostStatus.PENDING_APPROVAL, false);
    await expect(publishTarget(target.id)).rejects.toThrow(ApprovalRequiredError);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("refuses an APPROVED status with no recorded approver", async () => {
    // Guards against a status set directly in the database, or by a bug, that
    // was never actually signed off by a person.
    const { target } = await seed(PostStatus.APPROVED, false);
    await expect(publishTarget(target.id)).rejects.toThrow(ApprovalRequiredError);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("publishes once a human has approved it", async () => {
    const { target } = await seed(PostStatus.APPROVED, true);
    const outcome = await publishTarget(target.id);

    expect(publishSpy).toHaveBeenCalledOnce();
    expect(outcome.externalPostId).toBe("ig-post-1");

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.status).toBe(TargetStatus.PUBLISHED);
  });

  it("records the learning features at publish time", async () => {
    // Phase 3 depends on this row existing for every published post.
    const { target } = await seed(PostStatus.APPROVED, true);
    await publishTarget(target.id);

    const features = await prisma.postFeatures.findUniqueOrThrow({
      where: { targetId: target.id },
    });
    expect(features.platform).toBe(Platform.INSTAGRAM);
    expect(features.mediaCount).toBe(1);
    expect(features.localHour).toBeGreaterThanOrEqual(0);
  });

  it("does not republish a target that already went out", async () => {
    const { target } = await seed(PostStatus.APPROVED, true);
    await publishTarget(target.id);
    publishSpy.mockClear();

    // A duplicate job delivery after a worker restart must be a no-op, not a
    // second post on a real account.
    const second = await publishTarget(target.id);
    expect(publishSpy).not.toHaveBeenCalled();
    expect(second.externalPostId).toBe("ig-post-1");
  });
});
