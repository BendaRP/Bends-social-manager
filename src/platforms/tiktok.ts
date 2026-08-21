import { createHash, randomBytes } from "node:crypto";
import { Platform, PostFormat, Visibility } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { platformFetch } from "./http";
import {
  PlatformError,
  type AccountIdentity,
  type AccountMetrics,
  type ConnectedAccount,
  type MediaConstraints,
  type NormalisedMetrics,
  type PlatformAdapter,
  type PublishRequest,
  type PublishResult,
  type PublishingQuota,
  type TokenSet,
} from "./types";

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/";

/**
 * Scopes, kept minimal.
 *
 * `video.publish` posts directly to the profile; `video.upload` would only put
 * a draft in the user's inbox, which defeats scheduling. `video.list` is needed
 * for phase 2 analytics. Deliberately not requested: `user.info.profile` and
 * `user.info.stats` beyond what the connection screen displays.
 */
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "user.info.stats",
  "video.publish",
  "video.list",
] as const;

/**
 * TikTok Content Posting API.
 *
 * Important operational note, and not a bug: until TikTok audits the API
 * client, every post it makes is forced to SELF_ONLY visibility, the connected
 * account must itself be set to private at the moment of posting, and content
 * published in that state does not become public retroactively once the audit
 * passes — it has to be posted again.
 *
 * That constraint is enforced here in the adapter rather than in the UI, so no
 * amount of clicking around the interface can produce a request that violates
 * it.
 */
export class TikTokAdapter implements PlatformAdapter {
  readonly platform = Platform.TIKTOK;
  readonly supportedFormats: PostFormat[] = [
    PostFormat.VIDEO,
    PostFormat.REEL,
    PostFormat.SINGLE_IMAGE,
    PostFormat.CAROUSEL,
  ];

  /** Whether TikTok has audited this API client. Off until proven otherwise. */
  constructor(private readonly isAudited: boolean = false) {}

  buildAuthorizationUrl(state: string, codeChallenge?: string): string {
    const env = getEnv();
    const url = new URL(TIKTOK_AUTH);
    url.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY);
    url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", `${env.APP_URL}/api/auth/tiktok/callback`);
    url.searchParams.set("state", state);
    if (codeChallenge) {
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<ConnectedAccount[]> {
    const env = getEnv();

    const token = await platformFetch<TikTokTokenResponse>({
      platform: this.platform,
      url: `${TIKTOK_API}/oauth/token/`,
      method: "POST",
      form: {
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code: decodeURIComponent(code),
        grant_type: "authorization_code",
        redirect_uri: `${env.APP_URL}/api/auth/tiktok/callback`,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      },
    });

    const profile = await this.fetchProfile(token.access_token);

    return [
      {
        externalId: token.open_id,
        username: profile.username ?? null,
        displayName: profile.display_name ?? null,
        avatarUrl: profile.avatar_url ?? null,
        tokens: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: new Date(Date.now() + token.expires_in * 1000),
          refreshTokenExpiresAt: token.refresh_expires_in
            ? new Date(Date.now() + token.refresh_expires_in * 1000)
            : null,
          scopes: token.scope ? token.scope.split(",") : [...TIKTOK_SCOPES],
        },
      },
    ];
  }

  async refreshTokens(tokens: TokenSet): Promise<TokenSet | null> {
    if (!tokens.refreshToken) {
      throw new PlatformError(
        "TikTok connection has no refresh token; the account must be reconnected",
        { platform: this.platform, code: "NO_REFRESH_TOKEN", retryable: false },
      );
    }

    const env = getEnv();
    const refreshed = await platformFetch<TikTokTokenResponse>({
      platform: this.platform,
      url: `${TIKTOK_API}/oauth/token/`,
      method: "POST",
      form: {
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      },
    });

    return {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      refreshTokenExpiresAt: refreshed.refresh_expires_in
        ? new Date(Date.now() + refreshed.refresh_expires_in * 1000)
        : null,
      scopes: refreshed.scope ? refreshed.scope.split(",") : tokens.scopes,
    };
  }

  /**
   * Asks TikTok what this creator is currently allowed to do.
   *
   * Called before every publish because the answer is not static: it reports
   * whether the account is private (which decides whether an unaudited post is
   * permitted at all), how many posts remain in the daily allowance, and the
   * maximum video duration for this specific account.
   */
  async fetchCreatorInfo(accessToken: string): Promise<CreatorInfo> {
    const response = await platformFetch<{ data?: CreatorInfo }>({
      platform: this.platform,
      url: `${TIKTOK_API}/post/publish/creator_info/query/`,
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: {},
    });

    if (!response.data) {
      throw new PlatformError("TikTok returned no creator info", {
        platform: this.platform,
        code: "NO_CREATOR_INFO",
        retryable: true,
      });
    }
    return response.data;
  }

  async publish(
    tokens: TokenSet,
    _account: AccountIdentity,
    request: PublishRequest,
  ): Promise<PublishResult> {
    const media = request.media[0];
    if (!media) {
      throw new PlatformError("TikTok requires at least one media item", {
        platform: this.platform,
        code: "NO_MEDIA",
        retryable: false,
      });
    }

    const creator = await this.fetchCreatorInfo(tokens.accessToken);
    const warnings: string[] = [];

    // --- The unaudited-client rules, enforced here and nowhere else --------
    let visibility = request.requestedVisibility;

    if (!this.isAudited) {
      if (visibility !== Visibility.SELF_ONLY) {
        warnings.push(
          "חשבון ה-API עדיין לא עבר Audit של טיקטוק, לכן הפוסט פורסם במצב Self-only (גלוי רק לך). " +
            "אחרי אישור ה-Audit יהיה צריך לפרסם אותו מחדש — פוסטים קיימים לא הופכים לציבוריים רטרואקטיבית.",
        );
      }
      visibility = Visibility.SELF_ONLY;

      // TikTok requires the account itself to be private while the client is
      // unaudited. Publishing into a public account in this state is rejected
      // by the platform, so fail early with an explanation rather than let the
      // scheduler burn retries on a request that cannot succeed.
      if (creator.privacy_level_options?.length && !creator.privacy_level_options.includes("SELF_ONLY")) {
        throw new PlatformError(
          "TikTok will not accept a Self-only post from this account. While the API client is " +
            "unaudited the connected TikTok account must be set to private in the app's privacy " +
            "settings. Switch it to private, or complete the TikTok audit to post publicly.",
          { platform: this.platform, code: "ACCOUNT_MUST_BE_PRIVATE", retryable: false },
        );
      }
    }

    if (
      media.type === "VIDEO" &&
      creator.max_video_post_duration_sec &&
      media.durationSec &&
      media.durationSec > creator.max_video_post_duration_sec
    ) {
      throw new PlatformError(
        `Video is ${Math.round(media.durationSec)}s but this TikTok account allows at most ` +
          `${creator.max_video_post_duration_sec}s`,
        { platform: this.platform, code: "VIDEO_TOO_LONG", retryable: false },
      );
    }

    const title = composeTikTokTitle(request.caption, request.hashtags);

    const publishId =
      media.type === "VIDEO"
        ? await this.initVideoPost(tokens.accessToken, media.url, title, visibility)
        : await this.initPhotoPost(tokens.accessToken, request, title, visibility);

    const status = await this.awaitPublish(tokens.accessToken, publishId);

    return {
      externalPostId: status.publicaly_available_post_id?.[0] ?? publishId,
      externalMediaId: publishId,
      effectiveVisibility: visibility,
      warnings,
      raw: status,
    };
  }

  private async initVideoPost(
    accessToken: string,
    videoUrl: string,
    title: string,
    visibility: Visibility,
  ): Promise<string> {
    const response = await platformFetch<{ data?: { publish_id?: string } }>({
      platform: this.platform,
      url: `${TIKTOK_API}/post/publish/video/init/`,
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        post_info: {
          title,
          privacy_level: visibility,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        // PULL_FROM_URL has TikTok fetch the file from our storage, avoiding a
        // chunked upload through this server. It requires the storage domain to
        // be verified in the TikTok developer console — see docs/SETUP.md.
        source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
      },
    });

    const publishId = response.data?.publish_id;
    if (!publishId) {
      throw new PlatformError("TikTok did not return a publish id", {
        platform: this.platform,
        code: "NO_PUBLISH_ID",
        retryable: true,
        raw: response,
      });
    }
    return publishId;
  }

  private async initPhotoPost(
    accessToken: string,
    request: PublishRequest,
    title: string,
    visibility: Visibility,
  ): Promise<string> {
    const images = request.media.filter((m) => m.type === "IMAGE");
    const response = await platformFetch<{ data?: { publish_id?: string } }>({
      platform: this.platform,
      url: `${TIKTOK_API}/post/publish/content/init/`,
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        media_type: "PHOTO",
        post_mode: "DIRECT_POST",
        post_info: {
          title,
          description: title,
          privacy_level: visibility,
          disable_comment: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index: 0,
          photo_images: images.map((m) => m.url),
        },
      },
    });

    const publishId = response.data?.publish_id;
    if (!publishId) {
      throw new PlatformError("TikTok did not return a publish id for the photo post", {
        platform: this.platform,
        code: "NO_PUBLISH_ID",
        retryable: true,
        raw: response,
      });
    }
    return publishId;
  }

  /**
   * TikTok accepts a post asynchronously: the init call returns immediately and
   * the video is downloaded and transcoded afterwards. Reporting success at
   * init time would mean recording posts that TikTok later rejected, so wait
   * for a terminal status instead.
   */
  private async awaitPublish(
    accessToken: string,
    publishId: string,
    timeoutMs = 5 * 60_000,
  ): Promise<PublishStatus> {
    const deadline = Date.now() + timeoutMs;
    let last: PublishStatus = { status: "PROCESSING_UPLOAD" };

    while (Date.now() < deadline) {
      const response = await platformFetch<{ data?: PublishStatus }>({
        platform: this.platform,
        url: `${TIKTOK_API}/post/publish/status/fetch/`,
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: { publish_id: publishId },
      });

      last = response.data ?? last;

      if (last.status === "PUBLISH_COMPLETE") return last;
      if (last.status === "FAILED") {
        throw new PlatformError(
          `TikTok rejected the post: ${last.fail_reason ?? "no reason given"}`,
          {
            platform: this.platform,
            code: last.fail_reason ?? "PUBLISH_FAILED",
            retryable: false,
            raw: last,
          },
        );
      }

      await sleep(5_000);
    }

    throw new PlatformError(
      `TikTok post was still ${last.status} after ${Math.round(timeoutMs / 1000)}s`,
      { platform: this.platform, code: "PUBLISH_TIMEOUT", retryable: true, raw: last },
    );
  }

  async fetchPostMetrics(
    tokens: TokenSet,
    _account: AccountIdentity,
    externalPostId: string,
  ): Promise<NormalisedMetrics> {
    const response = await platformFetch<{ data?: { videos?: TikTokVideo[] } }>({
      platform: this.platform,
      url: `${TIKTOK_API}/video/query/?fields=id,like_count,comment_count,share_count,view_count,title,create_time,duration`,
      method: "POST",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { filters: { video_ids: [externalPostId] } },
    });

    const video = response.data?.videos?.[0];
    if (!video) {
      throw new PlatformError(`TikTok returned no data for video ${externalPostId}`, {
        platform: this.platform,
        code: "VIDEO_NOT_FOUND",
        // A Self-only post can be invisible to the query API; retrying later is
        // reasonable in case it becomes visible.
        retryable: true,
      });
    }

    return {
      // TikTok reports views, not unique reach.
      reach: null,
      impressions: video.view_count ?? null,
      likes: video.like_count ?? null,
      comments: video.comment_count ?? null,
      shares: video.share_count ?? null,
      saves: null,
      videoViews: video.view_count ?? null,
      raw: video,
    };
  }

  async fetchAccountMetrics(tokens: TokenSet): Promise<AccountMetrics> {
    const profile = await this.fetchProfile(tokens.accessToken);
    return {
      followerCount: profile.follower_count ?? null,
      followingCount: profile.following_count ?? null,
      mediaCount: profile.video_count ?? null,
      raw: profile,
    };
  }

  /**
   * Derived from creator_info rather than assumed: TikTok reports the remaining
   * daily post allowance per account, which is the number that actually
   * constrains us.
   */
  async fetchPublishingQuota(tokens: TokenSet): Promise<PublishingQuota> {
    try {
      const creator = await this.fetchCreatorInfo(tokens.accessToken);
      if (typeof creator.creator_can_post === "boolean") {
        return {
          used: null,
          total: creator.creator_can_post ? null : 0,
          windowSeconds: 86_400,
          source: "live",
          raw: creator,
        };
      }
    } catch {
      // Fall through.
    }
    return { used: null, total: 10, windowSeconds: 86_400, source: "fallback" };
  }

  private async fetchProfile(accessToken: string): Promise<TikTokProfile> {
    const response = await platformFetch<{ data?: { user?: TikTokProfile } }>({
      platform: this.platform,
      url:
        `${TIKTOK_API}/user/info/?fields=open_id,union_id,avatar_url,display_name,` +
        `username,follower_count,following_count,likes_count,video_count`,
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return response.data?.user ?? {};
  }

  mediaConstraints(): MediaConstraints {
    return {
      image: {
        maxSizeBytes: 20 * 1024 * 1024,
        minAspectRatio: 0.5,
        maxAspectRatio: 2,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      },
      video: {
        maxSizeBytes: 4 * 1024 * 1024 * 1024,
        minDurationSec: 3,
        // Per-account ceiling is read live from creator_info; this is the outer
        // bound the platform allows anyone.
        maxDurationSec: 600,
        minAspectRatio: 0.1,
        maxAspectRatio: 10,
        allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
      },
      maxCarouselItems: 35,
      // The title field is short; overflow is rejected rather than truncated.
      maxCaptionLength: 2200,
    };
  }
}

/**
 * PKCE verifier/challenge pair. TikTok requires PKCE for web authorisation, and
 * it also protects the flow against an intercepted authorisation code.
 */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  // TikTok expects the challenge hex-encoded, not base64url as RFC 7636 and
  // every other provider use. Do not "correct" this — base64url is rejected.
  const challenge = createHash("sha256").update(verifier).digest("hex");
  return { verifier, challenge };
}

function composeTikTokTitle(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const combined = [caption, tags].filter(Boolean).join(" ");
  return combined.slice(0, 2200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  refresh_expires_in?: number;
  scope?: string;
}

interface TikTokProfile {
  open_id?: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
  follower_count?: number;
  following_count?: number;
  video_count?: number;
}

export interface CreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  creator_can_post?: boolean;
  max_video_post_duration_sec?: number;
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
}

interface PublishStatus {
  status: string;
  fail_reason?: string;
  publicaly_available_post_id?: string[];
}

interface TikTokVideo {
  id?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
  duration?: number;
}
