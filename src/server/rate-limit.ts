import type { Platform } from "@prisma/client";
import { getRedis } from "./redis";

/**
 * Per-account publishing rate limiter.
 *
 * Rate limits are a platform rule, and exceeding them repeatedly is the kind of
 * behaviour that gets a business account restricted. Two layers guard against
 * that:
 *
 *   1. A sliding-window counter here, which is our own conservative ceiling.
 *   2. The platform's live quota reading, checked separately before publish.
 *
 * The counter is a Redis sorted set of publish timestamps. A sorted set is used
 * rather than a plain counter with a TTL because platform quotas are rolling
 * windows: "25 in the last 24 hours" is not the same as "25 since midnight",
 * and a TTL-based counter would let a burst through right after it reset.
 */

export interface RateLimitDecision {
  allowed: boolean;
  used: number;
  limit: number;
  /** When the oldest entry falls out of the window, freeing a slot. */
  retryAfterSeconds: number | null;
}

function key(platform: Platform, accountId: string): string {
  return `publish:window:${platform}:${accountId}`;
}

/**
 * Checks the window without consuming a slot.
 *
 * Separating check from consume matters: the publish flow checks first, does
 * the (slow, fallible) platform call, and records the slot only on success — so
 * a failed publish does not eat quota.
 */
export async function checkRateLimit(
  platform: Platform,
  accountId: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const redis = getRedis();
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const redisKey = key(platform, accountId);

  await redis.zremrangebyscore(redisKey, 0, windowStart);
  const used = await redis.zcard(redisKey);

  if (used < limit) {
    return { allowed: true, used, limit, retryAfterSeconds: null };
  }

  const oldest = await redis.zrange(redisKey, "0", "0", "WITHSCORES");
  const oldestScore = oldest[1] ? Number(oldest[1]) : now;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((oldestScore + windowSeconds * 1000 - now) / 1000),
  );

  return { allowed: false, used, limit, retryAfterSeconds };
}

/** Records a successful publish against the window. */
export async function recordPublish(
  platform: Platform,
  accountId: string,
  windowSeconds: number,
): Promise<void> {
  const redis = getRedis();
  const now = Date.now();
  const redisKey = key(platform, accountId);

  await redis.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2)}`);
  // Expire the whole key a full window after the last write, so idle accounts
  // do not leave stale keys behind.
  await redis.expire(redisKey, windowSeconds * 2);
}

/**
 * Minimum spacing between posts to the same account.
 *
 * Platform quotas allow far more than this, but publishing several posts within
 * a few minutes reads as automation and tends to suppress reach. Spacing them
 * is also simply better social media practice.
 */
export const MIN_SECONDS_BETWEEN_POSTS = 15 * 60;

export async function secondsSinceLastPublish(
  platform: Platform,
  accountId: string,
): Promise<number | null> {
  const redis = getRedis();
  const entries = await redis.zrange(key(platform, accountId), "-1", "-1", "WITHSCORES");
  const score = entries[1];
  if (!score) return null;
  return Math.floor((Date.now() - Number(score)) / 1000);
}
