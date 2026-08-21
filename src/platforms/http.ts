import type { Platform } from "@prisma/client";
import { PlatformError } from "./types";
import { redactSecrets } from "@/lib/crypto";

/**
 * Shared HTTP layer for platform calls.
 *
 * Its main job is turning wildly different error shapes into one PlatformError
 * carrying a `retryable` flag, so the publish worker can tell "the network
 * hiccuped, try again" apart from "this caption is too long, trying again will
 * never help".
 */

interface RequestOptions {
  platform: Platform;
  url: string;
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * HTTP statuses worth retrying. 429 is rate limiting; 5xx are the platform's
 * problem, not ours. Everything else is a request we got wrong.
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Meta error subcodes that mean "transient, come back later" despite arriving
 * with a 400. Meta returns application-level errors inside HTTP 200/400 bodies,
 * so status alone is not enough to classify them.
 */
const META_RETRYABLE_CODES = new Set([
  1, // API Unknown — Meta's own "unexpected, retry" code
  2, // API Service — temporary service issue
  4, // API Too Many Calls
  17, // API User Too Many Calls
  32, // Page-level rate limit
  341, // Application limit reached
  613, // Calls to this API have exceeded the rate limit
]);

export async function platformFetch<T = unknown>(
  options: RequestOptions,
): Promise<T> {
  const {
    platform,
    url,
    method = "GET",
    headers = {},
    body,
    form,
    timeoutMs = 30_000,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let init: RequestInit = { method, headers, signal: controller.signal };

  if (form) {
    init = {
      ...init,
      headers: {
        ...headers,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
    };
  } else if (body !== undefined) {
    init = {
      ...init,
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new PlatformError(
      aborted
        ? `Request to ${platform} timed out after ${timeoutMs}ms`
        : `Network error calling ${platform}: ${(error as Error).message}`,
      { platform, retryable: true, raw: redactSecrets(String(error)) },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw classifyError(platform, response, parsed);
  }

  // TikTok reports application-level failures inside a 200 response.
  const tiktokError = extractTikTokError(parsed);
  if (tiktokError) {
    throw new PlatformError(tiktokError.message, {
      platform,
      code: tiktokError.code,
      httpStatus: response.status,
      retryable: tiktokError.retryable,
      raw: redactSecrets(parsed),
    });
  }

  return parsed as T;
}

function classifyError(
  platform: Platform,
  response: Response,
  parsed: unknown,
): PlatformError {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader
    ? Number(retryAfterHeader)
    : undefined;

  const metaError = (parsed as { error?: MetaErrorBody } | null)?.error;
  if (metaError && typeof metaError === "object" && "message" in metaError) {
    const code = metaError.code;
    return new PlatformError(
      `${platform}: ${metaError.message}` +
        (metaError.error_user_msg ? ` — ${metaError.error_user_msg}` : ""),
      {
        platform,
        code: code !== undefined ? String(code) : undefined,
        httpStatus: response.status,
        retryable:
          RETRYABLE_STATUSES.has(response.status) ||
          (typeof code === "number" && META_RETRYABLE_CODES.has(code)),
        retryAfterSeconds,
        raw: redactSecrets(parsed),
      },
    );
  }

  const tiktokError = extractTikTokError(parsed);
  if (tiktokError) {
    return new PlatformError(tiktokError.message, {
      platform,
      code: tiktokError.code,
      httpStatus: response.status,
      retryable: tiktokError.retryable || RETRYABLE_STATUSES.has(response.status),
      retryAfterSeconds,
      raw: redactSecrets(parsed),
    });
  }

  return new PlatformError(
    `${platform} request failed with HTTP ${response.status}`,
    {
      platform,
      httpStatus: response.status,
      retryable: RETRYABLE_STATUSES.has(response.status),
      retryAfterSeconds,
      raw: redactSecrets(parsed),
    },
  );
}

interface MetaErrorBody {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

/** TikTok wraps status in `error: { code: "ok" | "...", message }`. */
const TIKTOK_RETRYABLE_CODES = new Set([
  "rate_limit_exceeded",
  "internal_error",
  "server_error",
  "spam_risk_too_many_posts",
]);

function extractTikTokError(
  parsed: unknown,
): { code: string; message: string; retryable: boolean } | null {
  const error = (parsed as { error?: { code?: string; message?: string } } | null)
    ?.error;
  if (!error || typeof error.code !== "string") return null;
  if (error.code === "ok") return null;

  return {
    code: error.code,
    message: `TIKTOK: ${error.message ?? error.code}`,
    retryable: TIKTOK_RETRYABLE_CODES.has(error.code),
  };
}
