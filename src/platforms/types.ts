import type { Platform, PostFormat, Visibility } from "@prisma/client";

/**
 * The seam between "what we want to publish" and "how a given network wants to
 * be told about it".
 *
 * Everything above this interface — scheduling, the approval gate, analytics,
 * the recommendation engine — is platform-agnostic. Everything network-specific
 * lives inside an adapter. That is what makes it possible to swap the TikTok
 * implementation for a third-party provider later without touching the rest of
 * the system.
 */

export interface MediaInput {
  type: "IMAGE" | "VIDEO";
  /** Publicly reachable URL. Both Meta and TikTok fetch media themselves. */
  url: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  sizeBytes: number;
}

export interface PublishRequest {
  format: PostFormat;
  caption: string;
  hashtags: string[];
  media: MediaInput[];
  requestedVisibility: Visibility;
  /** Correlates platform-side logs with our PublishAttempt rows. */
  idempotencyKey: string;
}

export interface PublishResult {
  externalPostId: string;
  externalMediaId?: string;
  permalink?: string;
  /** What the platform actually applied — may differ from what was requested. */
  effectiveVisibility: Visibility;
  /** Surfaced to the user, e.g. the TikTok self-only notice. */
  warnings: string[];
  raw?: unknown;
}

export interface NormalisedMetrics {
  reach?: number | null;
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  videoViews?: number | null;
  watchTimeSec?: number | null;
  avgWatchTimeSec?: number | null;
  completionRate?: number | null;
  profileVisits?: number | null;
  followsGained?: number | null;
  linkClicks?: number | null;
  raw?: unknown;
}

export interface AccountMetrics {
  followerCount?: number | null;
  followingCount?: number | null;
  mediaCount?: number | null;
  reach?: number | null;
  impressions?: number | null;
  profileVisits?: number | null;
  raw?: unknown;
}

/**
 * Publishing quota as reported by the platform itself.
 *
 * Deliberately not a constant. Published figures for Instagram's daily
 * publishing cap disagree with one another, and Meta adjusts them; the only
 * number worth trusting is the one the account's own quota endpoint returns.
 * `source` records whether we got a live answer or fell back to a documented
 * default, so the UI can be honest about which it is showing.
 */
export interface PublishingQuota {
  used: number | null;
  total: number | null;
  windowSeconds: number;
  source: "live" | "fallback";
  raw?: unknown;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scopes: string[];
}

export interface AccountIdentity {
  externalId: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  linkedPageId?: string | null;
  linkedPageName?: string | null;
}

export interface ConnectedAccount extends AccountIdentity {
  tokens: TokenSet;
}

/** Per-platform media rules, checked before anything is queued. */
export interface MediaConstraints {
  image?: {
    maxSizeBytes: number;
    minAspectRatio: number;
    maxAspectRatio: number;
    allowedMimeTypes: string[];
  };
  video?: {
    maxSizeBytes: number;
    minDurationSec: number;
    maxDurationSec: number;
    minAspectRatio: number;
    maxAspectRatio: number;
    allowedMimeTypes: string[];
  };
  maxCarouselItems?: number;
  maxCaptionLength: number;
  maxHashtags?: number;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly supportedFormats: PostFormat[];

  /** OAuth step 1 — where to send the browser. */
  buildAuthorizationUrl(state: string, codeChallenge?: string): string;

  /** OAuth step 2 — swap the returned code for tokens plus account identity. */
  exchangeCode(code: string, codeVerifier?: string): Promise<ConnectedAccount[]>;

  /** Renew before expiry. Returns null when the platform has nothing to renew. */
  refreshTokens(tokens: TokenSet): Promise<TokenSet | null>;

  publish(tokens: TokenSet, account: AccountIdentity, request: PublishRequest): Promise<PublishResult>;

  fetchPostMetrics(
    tokens: TokenSet,
    account: AccountIdentity,
    externalPostId: string,
  ): Promise<NormalisedMetrics>;

  fetchAccountMetrics(tokens: TokenSet, account: AccountIdentity): Promise<AccountMetrics>;

  /** Live quota lookup; adapters that cannot ask return a documented fallback. */
  fetchPublishingQuota(tokens: TokenSet, account: AccountIdentity): Promise<PublishingQuota>;

  mediaConstraints(format: PostFormat): MediaConstraints;
}

/** Structured platform error, so retry logic can distinguish causes. */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly options: {
      platform: Platform;
      code?: string;
      httpStatus?: number;
      /** False for permanent failures — a bad caption will not fix itself. */
      retryable: boolean;
      /** Honour Retry-After when the platform sends one. */
      retryAfterSeconds?: number;
      raw?: unknown;
    },
  ) {
    super(message);
    this.name = "PlatformError";
  }
}
