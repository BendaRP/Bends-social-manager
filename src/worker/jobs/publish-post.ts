import { UnrecoverableError, type Job } from "bullmq";
import { PlatformError } from "@/platforms/types";
import {
  ApprovalRequiredError,
  RateLimitedError,
  publishTarget,
} from "@/server/publish";
import { scheduleMetricCollection, type PublishJobData } from "../queues";

/**
 * The publish job.
 *
 * Its only real responsibility beyond calling publishTarget is deciding what a
 * failure means: retry, wait, or stop. Getting that wrong is expensive in both
 * directions — retrying a permanent failure five times wastes rate-limit budget
 * on a post that can never succeed, while giving up on a transient one means a
 * post silently never goes out.
 */
export async function runPublishJob(job: Job<PublishJobData>): Promise<void> {
  const { targetId } = job.data;

  try {
    const outcome = await publishTarget(targetId);

    for (const warning of outcome.warnings) {
      console.warn(`[publish] ${targetId}: ${warning}`);
    }

    // Only start collecting metrics once something was actually published.
    await scheduleMetricCollection(targetId);
  } catch (error) {
    // An unapproved post is not a failure to retry — it is the approval gate
    // doing its job. Retrying would just hammer the same refusal.
    if (error instanceof ApprovalRequiredError) {
      throw new UnrecoverableError(error.message);
    }

    // Rate limited: this will succeed later, so push the job back rather than
    // consuming a retry attempt on something we know is too early.
    if (error instanceof RateLimitedError) {
      await job.moveToDelayed(Date.now() + error.retryAfterSeconds * 1000, job.token);
      return;
    }

    if (error instanceof PlatformError) {
      if (!error.options.retryable) {
        throw new UnrecoverableError(`${error.message} (code ${error.options.code ?? "none"})`);
      }
      if (error.options.retryAfterSeconds) {
        await job.moveToDelayed(
          Date.now() + error.options.retryAfterSeconds * 1000,
          job.token,
        );
        return;
      }
    }

    throw error;
  }
}
