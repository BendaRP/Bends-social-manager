import { Platform, PostFormat, Visibility } from "@prisma/client";
import { getEnv } from "@/lib/env";
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
} from "../types";
import {
  exchangeForLongLivedToken,
  fetchInsightsResilient,
  flattenInsights,
  graphGet,
  graphPost,
  waitForContainer,
} from "./client";
import { metaScopes, metaScopeString } from "./scopes";
import { exchangeMetaLogin, type MetaPage } from "./connect";

/**
 * Instagram Business/Creator publishing via the Meta Graph API.
 *
 * Publishing is always two calls: build a media container, then publish it.
 * Carousels add a layer — each slide is its own container first, then a parent
 * container collects them.
 */
export class InstagramAdapter implements PlatformAdapter {
  readonly platform = Platform.INSTAGRAM;
  readonly supportedFormats: PostFormat[] = [
    PostFormat.SINGLE_IMAGE,
    PostFormat.CAROUSEL,
    PostFormat.REEL,
    PostFormat.VIDEO,
    PostFormat.STORY,
  ];

  buildAuthorizationUrl(state: string): string {
    const env = getEnv();
    const url = new URL(
      `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`,
    );
    url.searchParams.set("client_id", env.META_APP_ID);
    url.searchParams.set("redirect_uri", `${env.APP_URL}/api/auth/meta/callback`);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", metaScopeString());
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  /**
   * Returns every Instagram account reachable through the user's pages.
   *
   * A login with pages but no linked Instagram account returns an empty list
   * rather than throwing: the Facebook Pages from that same login are still
   * usable, and failing here would throw them away too.
   */
  async exchangeCode(code: string): Promise<ConnectedAccount[]> {
    const { pages, expiresAt } = await exchangeMetaLogin(code);
    return instagramAccountsFrom(pages, expiresAt);
  }

  /**
   * Meta has no refresh-token grant; a long-lived token is re-exchanged for a
   * fresh one instead. Doing this well before the 60-day expiry keeps the
   * connection alive indefinitely without the user logging in again.
   */
  async refreshTokens(tokens: TokenSet): Promise<TokenSet | null> {
    const refreshed = await exchangeForLongLivedToken(
      this.platform,
      tokens.accessToken,
    );
    return {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scopes: tokens.scopes,
    };
  }

  async publish(
    tokens: TokenSet,
    account: AccountIdentity,
    request: PublishRequest,
  ): Promise<PublishResult> {
    const igUserId = account.externalId;
    const token = tokens.accessToken;
    const caption = composeCaption(request.caption, request.hashtags);

    const creationId =
      request.format === PostFormat.CAROUSEL
        ? await this.createCarouselContainer(igUserId, token, request, caption)
        : await this.createSingleContainer(igUserId, token, request, caption);

    await waitForContainer(this.platform, creationId, token);

    const published = await graphPost<{ id: string }>(
      this.platform,
      `${igUserId}/media_publish`,
      { creation_id: creationId, access_token: token },
    );

    const permalink = await this.fetchPermalink(published.id, token);

    return {
      externalPostId: published.id,
      externalMediaId: creationId,
      permalink: permalink ?? undefined,
      // Instagram has no per-post visibility control via the API; posts follow
      // the account's own public/private setting.
      effectiveVisibility: Visibility.PUBLIC,
      warnings: [],
    };
  }

  private async createSingleContainer(
    igUserId: string,
    token: string,
    request: PublishRequest,
    caption: string,
  ): Promise<string> {
    const media = request.media[0];
    if (!media) {
      throw new PlatformError("Instagram requires at least one media item", {
        platform: this.platform,
        code: "NO_MEDIA",
        retryable: false,
      });
    }

    const form: Record<string, string | undefined> = {
      access_token: token,
      // Stories carry no caption on Instagram; sending one is silently dropped.
      caption: request.format === PostFormat.STORY ? undefined : caption,
    };

    if (media.type === "IMAGE") {
      form.image_url = media.url;
      if (request.format === PostFormat.STORY) form.media_type = "STORIES";
    } else {
      form.video_url = media.url;
      form.media_type =
        request.format === PostFormat.STORY
          ? "STORIES"
          : // Standalone video posts land in the Reels surface; asking for
            // REELS explicitly is what Meta expects for feed video.
            "REELS";
    }

    const container = await graphPost<{ id: string }>(
      this.platform,
      `${igUserId}/media`,
      form,
    );
    return container.id;
  }

  private async createCarouselContainer(
    igUserId: string,
    token: string,
    request: PublishRequest,
    caption: string,
  ): Promise<string> {
    const constraints = this.mediaConstraints(PostFormat.CAROUSEL);
    const maxItems = constraints.maxCarouselItems ?? 10;

    if (request.media.length < 2 || request.media.length > maxItems) {
      throw new PlatformError(
        `An Instagram carousel needs between 2 and ${maxItems} items, got ${request.media.length}`,
        { platform: this.platform, code: "CAROUSEL_SIZE", retryable: false },
      );
    }

    // Child containers are created sequentially rather than in parallel: Meta's
    // per-account call limit is low enough that a burst of parallel container
    // creations is a realistic way to trip it mid-publish.
    const childIds: string[] = [];
    for (const media of request.media) {
      const child = await graphPost<{ id: string }>(
        this.platform,
        `${igUserId}/media`,
        {
          access_token: token,
          is_carousel_item: "true",
          ...(media.type === "IMAGE"
            ? { image_url: media.url }
            : { video_url: media.url, media_type: "VIDEO" }),
        },
      );
      childIds.push(child.id);
    }

    for (const childId of childIds) {
      await waitForContainer(this.platform, childId, token);
    }

    const parent = await graphPost<{ id: string }>(
      this.platform,
      `${igUserId}/media`,
      {
        access_token: token,
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
      },
    );
    return parent.id;
  }

  private async fetchPermalink(mediaId: string, token: string): Promise<string | null> {
    try {
      const result = await graphGet<{ permalink?: string }>(this.platform, mediaId, {
        fields: "permalink",
        access_token: token,
      });
      return result.permalink ?? null;
    } catch {
      // A missing permalink is cosmetic — never fail an otherwise successful
      // publish over it.
      return null;
    }
  }

  async fetchPostMetrics(
    tokens: TokenSet,
    _account: AccountIdentity,
    externalPostId: string,
  ): Promise<NormalisedMetrics> {
    // Superset of the metrics Instagram has exposed across recent versions.
    // fetchInsightsResilient drops whatever this account's API version rejects,
    // so a rename upstream degrades one metric instead of breaking collection.
    const requested = [
      "reach",
      "impressions",
      "views",
      "likes",
      "comments",
      "shares",
      "saved",
      "total_interactions",
      "profile_visits",
      "follows",
      "ig_reels_video_view_total_time",
      "ig_reels_avg_watch_time",
    ];

    const response = await fetchInsightsResilient(
      this.platform,
      `${externalPostId}/insights`,
      requested,
      { access_token: tokens.accessToken },
    );
    const metrics = flattenInsights(response);

    // Comment and like counts also live on the media object itself, which stays
    // available even when the insights endpoint declines a metric.
    const media = await graphGet<{
      like_count?: number;
      comments_count?: number;
      media_product_type?: string;
    }>(this.platform, externalPostId, {
      fields: "like_count,comments_count,media_product_type",
      access_token: tokens.accessToken,
    }).catch(() => ({}) as Record<string, never>);

    const watchTimeMs = metrics.ig_reels_video_view_total_time;
    const avgWatchMs = metrics.ig_reels_avg_watch_time;

    return {
      reach: metrics.reach ?? null,
      // `views` supersedes `impressions` in newer API versions; accept either.
      impressions: metrics.impressions ?? metrics.views ?? null,
      likes: metrics.likes ?? media.like_count ?? null,
      comments: metrics.comments ?? media.comments_count ?? null,
      shares: metrics.shares ?? null,
      saves: metrics.saved ?? null,
      videoViews: metrics.views ?? null,
      watchTimeSec: watchTimeMs !== undefined ? watchTimeMs / 1000 : null,
      avgWatchTimeSec: avgWatchMs !== undefined ? avgWatchMs / 1000 : null,
      profileVisits: metrics.profile_visits ?? null,
      followsGained: metrics.follows ?? null,
      raw: { insights: metrics, media },
    };
  }

  async fetchAccountMetrics(
    tokens: TokenSet,
    account: AccountIdentity,
  ): Promise<AccountMetrics> {
    const profile = await graphGet<{
      followers_count?: number;
      follows_count?: number;
      media_count?: number;
    }>(this.platform, account.externalId, {
      fields: "followers_count,follows_count,media_count",
      access_token: tokens.accessToken,
    });

    const insights = await fetchInsightsResilient(
      this.platform,
      `${account.externalId}/insights`,
      ["reach", "impressions", "views", "profile_views"],
      { period: "day", metric_type: "total_value", access_token: tokens.accessToken },
    )
      .then(flattenInsights)
      .catch(() => ({}) as Record<string, number>);

    return {
      followerCount: profile.followers_count ?? null,
      followingCount: profile.follows_count ?? null,
      mediaCount: profile.media_count ?? null,
      reach: insights.reach ?? null,
      impressions: insights.impressions ?? insights.views ?? null,
      profileVisits: insights.profile_views ?? null,
      raw: { profile, insights },
    };
  }

  /**
   * Asks the account how much of its publishing quota is left.
   *
   * This is deliberately a live lookup. Published figures for the daily cap
   * disagree with one another and Meta changes them; the account's own answer is
   * the only one that is actually true for this account right now.
   */
  async fetchPublishingQuota(
    tokens: TokenSet,
    account: AccountIdentity,
  ): Promise<PublishingQuota> {
    try {
      const result = await graphGet<{
        data?: Array<{
          quota_usage?: number;
          config?: { quota_total?: number; quota_duration?: number };
        }>;
      }>(this.platform, `${account.externalId}/content_publishing_limit`, {
        fields: "config,quota_usage",
        access_token: tokens.accessToken,
      });

      const entry = result.data?.[0];
      if (entry) {
        return {
          used: entry.quota_usage ?? null,
          total: entry.config?.quota_total ?? null,
          windowSeconds: entry.config?.quota_duration ?? 86_400,
          source: "live",
          raw: result,
        };
      }
    } catch {
      // Fall through to the conservative default below.
    }

    // Conservative fallback used only when the live lookup fails: assume the
    // lowest cap reported anywhere, so an unknown quota can never cause us to
    // over-publish.
    return { used: null, total: 25, windowSeconds: 86_400, source: "fallback" };
  }

  mediaConstraints(format: PostFormat): MediaConstraints {
    const image = {
      maxSizeBytes: 8 * 1024 * 1024,
      minAspectRatio: 0.8, // 4:5 portrait
      maxAspectRatio: 1.91, // 1.91:1 landscape
      allowedMimeTypes: ["image/jpeg", "image/png"],
    };

    const video = {
      maxSizeBytes: 1024 * 1024 * 1024,
      minDurationSec: 3,
      maxDurationSec: format === PostFormat.STORY ? 60 : 900,
      minAspectRatio: 0.01,
      maxAspectRatio: 10,
      allowedMimeTypes: ["video/mp4", "video/quicktime"],
    };

    return {
      image,
      video,
      maxCarouselItems: 10,
      maxCaptionLength: 2200,
      maxHashtags: 30,
    };
  }
}

function composeCaption(caption: string, hashtags: string[]): string {
  if (hashtags.length === 0) return caption;
  const tags = hashtags
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");
  return caption ? `${caption}\n\n${tags}` : tags;
}


/** Maps a Meta login's pages to the Instagram accounts hanging off them. */
export function instagramAccountsFrom(
  pages: MetaPage[],
  expiresAt: Date | null,
): ConnectedAccount[] {
  return pages
    .filter((page) => page.instagram)
    .map((page) => ({
      externalId: page.instagram!.id,
      username: page.instagram!.username ?? null,
      displayName: page.instagram!.name ?? null,
      avatarUrl: page.instagram!.avatarUrl ?? null,
      linkedPageId: page.id,
      linkedPageName: page.name,
      tokens: {
        // Page tokens derived from a long-lived user token do not expire on
        // their own, but they die with the user token, so the expiry is
        // tracked and refreshed on the user token's schedule.
        accessToken: page.accessToken,
        expiresAt,
        scopes: metaScopes(),
      },
    }));
}

export { composeCaption };
