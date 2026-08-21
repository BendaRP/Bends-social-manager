import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { TargetStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { getAdapter } from "@/platforms";
import { ensureFreshTokens, toIdentity } from "@/server/accounts";
import { computeEngagementRate } from "@/lib/features";
import { redactSecrets } from "@/lib/crypto";
import { localDateOnly } from "@/lib/time";
import type { MetricsJobData } from "../queues";

/**
 * Collects one reading of a published post's performance.
 *
 * Phase 1 only records these; phase 2 puts them on screen and phase 3 learns
 * from them. Starting collection now means that when the analysis arrives it
 * has real history behind it instead of an empty table.
 */
export async function runMetricsJob(job: Job<MetricsJobData>): Promise<void> {
  const { targetId, ageMinutes } = job.data;

  const target = await prisma.postTarget.findUnique({
    where: { id: targetId },
    include: { account: true },
  });

  if (!target || target.status !== TargetStatus.PUBLISHED || !target.externalPostId) {
    throw new UnrecoverableError(
      `Target ${targetId} is not in a published state; nothing to measure`,
    );
  }

  const adapter = getAdapter(target.account.platform, {
    isAudited: target.account.isAudited,
  });
  const tokens = await ensureFreshTokens(target.account);
  const identity = toIdentity(target.account);

  const metrics = await adapter.fetchPostMetrics(tokens, identity, target.externalPostId);

  await prisma.metricSnapshot.upsert({
    where: { targetId_ageMinutes: { targetId, ageMinutes } },
    create: {
      targetId,
      ageMinutes,
      ...normalise(metrics),
    },
    update: normalise(metrics),
  });

  // Account-level numbers are captured alongside post metrics rather than on
  // their own schedule: follower growth is only interpretable next to the posts
  // that plausibly caused it.
  await captureAccountSnapshot(target.accountId);
}

function normalise(metrics: Awaited<ReturnType<ReturnType<typeof getAdapter>["fetchPostMetrics"]>>) {
  return {
    reach: metrics.reach ?? null,
    impressions: metrics.impressions ?? null,
    likes: metrics.likes ?? null,
    comments: metrics.comments ?? null,
    shares: metrics.shares ?? null,
    saves: metrics.saves ?? null,
    videoViews: metrics.videoViews ?? null,
    watchTimeSec: metrics.watchTimeSec ?? null,
    avgWatchTimeSec: metrics.avgWatchTimeSec ?? null,
    completionRate: metrics.completionRate ?? null,
    profileVisits: metrics.profileVisits ?? null,
    followsGained: metrics.followsGained ?? null,
    linkClicks: metrics.linkClicks ?? null,
    engagementRate: computeEngagementRate(metrics),
    raw: redactSecrets(metrics.raw ?? null) as object,
  };
}

export async function captureAccountSnapshot(accountId: string): Promise<void> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account) return;

  const adapter = getAdapter(account.platform, { isAudited: account.isAudited });
  const tokens = await ensureFreshTokens(account);

  try {
    const metrics = await adapter.fetchAccountMetrics(tokens, toIdentity(account));
    const localDate = localDateOnly(new Date());

    await prisma.accountMetricSnapshot.upsert({
      where: { accountId_localDate: { accountId, localDate } },
      create: {
        accountId,
        localDate,
        followerCount: metrics.followerCount ?? null,
        followingCount: metrics.followingCount ?? null,
        mediaCount: metrics.mediaCount ?? null,
        reach: metrics.reach ?? null,
        impressions: metrics.impressions ?? null,
        profileVisits: metrics.profileVisits ?? null,
        raw: redactSecrets(metrics.raw ?? null) as object,
      },
      update: {
        followerCount: metrics.followerCount ?? null,
        followingCount: metrics.followingCount ?? null,
        mediaCount: metrics.mediaCount ?? null,
        reach: metrics.reach ?? null,
        impressions: metrics.impressions ?? null,
        profileVisits: metrics.profileVisits ?? null,
        raw: redactSecrets(metrics.raw ?? null) as object,
      },
    });
  } catch (error) {
    // A missing follower count must never fail the post metric collection that
    // triggered it — the post reading is the more valuable of the two.
    console.warn(
      `[metrics] account snapshot failed for ${account.platform}: ${(error as Error).message}`,
    );
  }
}
