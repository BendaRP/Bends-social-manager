import { Queue, type JobsOptions } from "bullmq";
import { getBullConnection } from "@/server/redis";

/**
 * Queue definitions, shared between the web app (which enqueues) and the worker
 * process (which consumes).
 */

export const QUEUE_NAMES = {
  publish: "publish-post",
  metrics: "collect-metrics",
  tokens: "refresh-tokens",
} as const;

export interface PublishJobData {
  targetId: string;
}

export interface MetricsJobData {
  targetId: string;
  /** Minutes after publish this collection represents. */
  ageMinutes: number;
}

export interface TokenRefreshJobData {
  accountId?: string;
}

let publishQueue: Queue<PublishJobData> | null = null;
let metricsQueue: Queue<MetricsJobData> | null = null;
let tokenQueue: Queue<TokenRefreshJobData> | null = null;

/**
 * Retry policy for publishing.
 *
 * Publishing is retried, but conservatively: five attempts with an exponential
 * backoff starting at a minute. The worker additionally refuses to retry errors
 * the platform marked permanent, so a caption that is too long fails once
 * rather than five times.
 */
const PUBLISH_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 30 * 24 * 3600, count: 1000 },
  removeOnFail: false,
};

export function getPublishQueue(): Queue<PublishJobData> {
  publishQueue ??= new Queue<PublishJobData>(QUEUE_NAMES.publish, {
    connection: getBullConnection(),
    defaultJobOptions: PUBLISH_JOB_OPTIONS,
  });
  return publishQueue;
}

export function getMetricsQueue(): Queue<MetricsJobData> {
  metricsQueue ??= new Queue<MetricsJobData>(QUEUE_NAMES.metrics, {
    connection: getBullConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 120_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
  return metricsQueue;
}

export function getTokenQueue(): Queue<TokenRefreshJobData> {
  tokenQueue ??= new Queue<TokenRefreshJobData>(QUEUE_NAMES.tokens, {
    connection: getBullConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 300_000 } },
  });
  return tokenQueue;
}

/**
 * Schedules a target for publishing.
 *
 * The job id is the target id, which makes enqueueing idempotent: approving a
 * post twice, or a retry of the enqueue call, cannot produce two jobs that both
 * publish the same content.
 */
export async function schedulePublish(
  targetId: string,
  scheduledAt: Date | null,
): Promise<void> {
  const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;
  const queue = getPublishQueue();

  // Remove any existing job first, so rescheduling an approved post actually
  // moves it rather than being ignored as a duplicate id.
  await queue.remove(targetId).catch(() => undefined);
  await queue.add("publish", { targetId }, { jobId: targetId, delay });
}

export async function cancelPublish(targetId: string): Promise<void> {
  await getPublishQueue().remove(targetId).catch(() => undefined);
}

/**
 * Metric collection schedule.
 *
 * Readings are taken at widening intervals rather than continuously. This keeps
 * well inside the platforms' hourly call budgets while still capturing the
 * shape of a post's life: most of the interesting variation happens in the
 * first day, and the 7-day reading is close to the final number.
 */
export const METRIC_COLLECTION_SCHEDULE_MINUTES = [60, 6 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60];

export async function scheduleMetricCollection(targetId: string): Promise<void> {
  const queue = getMetricsQueue();
  for (const ageMinutes of METRIC_COLLECTION_SCHEDULE_MINUTES) {
    await queue.add(
      "collect",
      { targetId, ageMinutes },
      { jobId: `${targetId}:${ageMinutes}`, delay: ageMinutes * 60_000 },
    );
  }
}
