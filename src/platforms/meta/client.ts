import type { Platform } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { platformFetch } from "../http";
import { PlatformError } from "../types";

/**
 * Shared Meta Graph API plumbing for the Instagram and Facebook adapters.
 *
 * The API version is pinned in configuration rather than left implicit. Meta
 * retires versions on a published schedule, and an unversioned call can change
 * behaviour underneath us with no deploy on our side; pinning turns that into a
 * deliberate upgrade instead of a surprise at publish time.
 */

export function graphBase(): string {
  return `https://graph.facebook.com/${getEnv().META_GRAPH_VERSION}`;
}

export function graphUrl(
  path: string,
  params: Record<string, string | undefined> = {},
): string {
  const url = new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function graphGet<T>(
  platform: Platform,
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  return platformFetch<T>({ platform, url: graphUrl(path, params), method: "GET" });
}

export async function graphPost<T>(
  platform: Platform,
  path: string,
  form: Record<string, string | undefined>,
): Promise<T> {
  const cleaned = Object.fromEntries(
    Object.entries(form).filter(([, v]) => v !== undefined && v !== ""),
  ) as Record<string, string>;

  return platformFetch<T>({
    platform,
    url: graphUrl(path),
    method: "POST",
    form: cleaned,
  });
}

/**
 * Meta rejects a whole insights request if any single metric name is unknown,
 * and it renames metrics between versions (media `impressions` became `views`,
 * for instance).
 *
 * Rather than hardcode one list and break the moment Meta moves, ask for the
 * full set and, if Meta objects to specific names, drop those and ask again.
 * The account tells us which metrics it supports; we do not have to guess.
 */
export async function fetchInsightsResilient(
  platform: Platform,
  path: string,
  metrics: string[],
  params: Record<string, string | undefined>,
): Promise<InsightsResponse> {
  try {
    return await graphGet<InsightsResponse>(platform, path, {
      ...params,
      metric: metrics.join(","),
    });
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;

    const rejected = parseRejectedMetrics(error, metrics);
    // Only retry when we learned something specific; otherwise the second call
    // would fail identically and just cost another request against the quota.
    if (rejected.length === 0) throw error;

    const remaining = metrics.filter((m) => !rejected.includes(m));
    if (remaining.length === 0) return { data: [] };

    return graphGet<InsightsResponse>(platform, path, {
      ...params,
      metric: remaining.join(","),
    });
  }
}

/**
 * Pulls unsupported metric names out of a Meta validation error.
 *
 * Meta phrases these as "(#100) metric[0] must be one of the following values:
 * reach, views, ..." — so the supported list is in the message. Anything we
 * asked for that is absent from that list is what it rejected.
 */
function parseRejectedMetrics(error: PlatformError, requested: string[]): string[] {
  const message = error.message;
  if (error.options.code !== "100" && !/must be one of/i.test(message)) return [];

  const listMatch = /must be one of the following values:\s*([^.]+)/i.exec(message);
  if (listMatch?.[1]) {
    const supported = new Set(
      listMatch[1]
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    const rejected = requested.filter((m) => !supported.has(m.toLowerCase()));
    if (rejected.length > 0) return rejected;
  }

  // Fall back to any requested metric named directly in the error text.
  return requested.filter((m) => new RegExp(`\\b${m}\\b`, "i").test(message));
}

export interface InsightsResponse {
  data: Array<{
    name: string;
    period?: string;
    title?: string;
    values?: Array<{ value: number | Record<string, number>; end_time?: string }>;
    total_value?: { value?: number };
  }>;
}

/** Flattens Meta's several insight response shapes into one metric map. */
export function flattenInsights(response: InsightsResponse): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of response.data ?? []) {
    if (typeof entry.total_value?.value === "number") {
      out[entry.name] = entry.total_value.value;
      continue;
    }
    const value = entry.values?.[0]?.value;
    if (typeof value === "number") out[entry.name] = value;
  }
  return out;
}

/**
 * Waits for an Instagram media container to finish processing.
 *
 * Video containers are not publishable the instant they are created — Meta
 * transcodes first, and publishing a container still in IN_PROGRESS fails.
 */
export async function waitForContainer(
  platform: Platform,
  containerId: string,
  accessToken: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  let lastStatus = "UNKNOWN";

  while (Date.now() < deadline) {
    const result = await graphGet<{ status_code?: string; status?: string }>(
      platform,
      containerId,
      { fields: "status_code,status", access_token: accessToken },
    );

    lastStatus = result.status_code ?? "UNKNOWN";

    if (lastStatus === "FINISHED") return;
    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
      throw new PlatformError(
        `Instagram rejected the media container (${lastStatus}): ${result.status ?? "no detail"}`,
        { platform, code: lastStatus, retryable: false, raw: result },
      );
    }

    await sleep(intervalMs);
  }

  throw new PlatformError(
    `Instagram media container was still ${lastStatus} after ${Math.round(timeoutMs / 1000)}s`,
    { platform, code: "CONTAINER_TIMEOUT", retryable: true },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Trades the short-lived login token for a long-lived one (~60 days).
 *
 * Without this step the connection would break a couple of hours after setup,
 * which for a scheduler means every post after the first day silently fails.
 */
export async function exchangeForLongLivedToken(
  platform: Platform,
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const env = getEnv();
  const result = await graphGet<MetaTokenResponse>(platform, "oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });

  return {
    accessToken: result.access_token,
    expiresAt: result.expires_in
      ? new Date(Date.now() + result.expires_in * 1000)
      : null,
  };
}
