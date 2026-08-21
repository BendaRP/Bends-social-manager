// Must come first: populates process.env before anything reads it.
import "@/lib/load-env";
import { Worker } from "bullmq";
import { getBullConnection } from "@/server/redis";
import { getEnv } from "@/lib/env";
import {
  QUEUE_NAMES,
  getTokenQueue,
  type MetricsJobData,
  type PublishJobData,
  type TokenRefreshJobData,
} from "./queues";
import { runPublishJob } from "./jobs/publish-post";
import { runMetricsJob } from "./jobs/collect-metrics";
import { runTokenRefreshJob } from "./jobs/refresh-tokens";

/**
 * The worker process.
 *
 * This runs continuously and separately from the Next.js app. That separation
 * is the whole reason scheduled publishing works: a serverless function only
 * exists while a request is in flight, so it cannot wake up at 07:00 to publish
 * a post nobody is currently looking at.
 */

async function main(): Promise<void> {
  const env = getEnv();
  const connection = getBullConnection();

  console.log(
    `[worker] starting — timezone ${env.AUDIENCE_TIMEZONE}, ` +
      `manual approval ${env.REQUIRE_MANUAL_APPROVAL ? "required" : "DISABLED"}`,
  );

  if (!env.REQUIRE_MANUAL_APPROVAL) {
    console.warn(
      "[worker] REQUIRE_MANUAL_APPROVAL is false — posts will publish without human sign-off",
    );
  }

  const publishWorker = new Worker<PublishJobData>(
    QUEUE_NAMES.publish,
    runPublishJob,
    {
      connection,
      // One publish at a time per process. Publishing is not CPU-bound, and
      // serialising it makes the rate limiter's check-then-act sequence safe
      // without needing a distributed lock.
      concurrency: 1,
    },
  );

  const metricsWorker = new Worker<MetricsJobData>(
    QUEUE_NAMES.metrics,
    runMetricsJob,
    { connection, concurrency: 2 },
  );

  const tokenWorker = new Worker<TokenRefreshJobData>(
    QUEUE_NAMES.tokens,
    runTokenRefreshJob,
    { connection, concurrency: 1 },
  );

  for (const [name, worker] of [
    ["publish", publishWorker],
    ["metrics", metricsWorker],
    ["tokens", tokenWorker],
  ] as const) {
    worker.on("failed", (job, error) => {
      console.error(`[${name}] job ${job?.id ?? "unknown"} failed: ${error.message}`);
    });
    worker.on("completed", (job) => {
      console.log(`[${name}] job ${job.id} completed`);
    });
  }

  // Refresh tokens twice a day. Tokens last weeks, so this is about having many
  // chances to recover from a transient failure, not about frequency.
  await getTokenQueue().upsertJobScheduler(
    "token-refresh",
    { pattern: "0 3,15 * * *", tz: env.AUDIENCE_TIMEZONE },
    { name: "refresh" },
  );

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, finishing in-flight jobs`);
    await Promise.all([
      publishWorker.close(),
      metricsWorker.close(),
      tokenWorker.close(),
    ]);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("[worker] ready");
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
