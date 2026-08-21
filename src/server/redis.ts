import IORedis from "ioredis";
import { getEnv } from "@/lib/env";

/**
 * Redis connections.
 *
 * BullMQ needs `maxRetriesPerRequest: null` — with a retry limit, a blocking
 * job-fetch command that outlives the limit throws and kills the worker, which
 * for a scheduler means scheduled posts stop going out.
 */
const globalForRedis = globalThis as unknown as {
  redis?: IORedis;
  redisBull?: IORedis;
};

export function getRedis(): IORedis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }
  return globalForRedis.redis;
}

export function getBullConnection(): IORedis {
  if (!globalForRedis.redisBull) {
    globalForRedis.redisBull = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return globalForRedis.redisBull;
}
