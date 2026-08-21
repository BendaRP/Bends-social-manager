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
} from "./client";
import { metaScopes, metaScopeString } from "./scopes";
import { exchangeMetaLogin, type MetaPage } from "./connect";
import { composeCaption } from "./instagram";

/**
 * Facebook Page publishing.
 *
 * Shares the Meta OAuth flow with Instagram — one login connects both — but the
 * publishing endpoints are entirely different: pages take a direct upload per
 * media type rather than Instagram's container-then-publish dance.
 */
export class FacebookAdapter implements PlatformAdapter {
  readonly platform = Platform.FACEBOOK;
  readonly supportedFormats: PostFormat[] = [
    PostFormat.SINGLE_IMAGE,
    PostFormat.CAROUSEL,
    PostFormat.VIDEO,
    PostFormat.TEXT,
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

  async exchangeCode(code: string): Promise<ConnectedAccount[]> {
    const { pages, expiresAt } = await exchangeMetaLogin(code);
    return facebookAccountsFrom(pages, expiresAt);
  }

  async refreshTokens(tokens: TokenSet): Promise<TokenSet | null> {
    const refreshed = await exchangeForLongLivedToken(this.platform, tokens.accessToken);
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
    const pageId = account.externalId;
    const token = tokens.accessToken;
    const message = composeCaption(request.caption, request.hashtags);

    if (request.format === PostFormat.STORY) {
      return this.publishStory(pageId, token, request);
    }
    if (request.media.length === 0) {
      return this.publishText(pageId, token, message);
    }
    if (request.media.length === 1) {
      const media = request.media[0]!;
      return media.type === "VIDEO"
        ? this.publishVideo(pageId, token, media.url, message)
        : this.publishSinglePhoto(pageId, token, media.url, message);
    }
    return this.publishMultiPhoto(pageId, token, request, message);
  }

  private async publishText(
    pageId: string,
    token: string,
    message: string,
  ): Promise<PublishResult> {
    const result = await graphPost<{ id: string }>(this.platform, `${pageId}/feed`, {
      message,
      access_token: token,
    });
    return this.toResult(result.id, pageId);
  }

  private async publishSinglePhoto(
    pageId: string,
    token: string,
    url: string,
    message: string,
  ): Promise<PublishResult> {
    const result = await graphPost<{ id: string; post_id?: string }>(
      this.platform,
      `${pageId}/photos`,
      { url, caption: message, published: "true", access_token: token },
    );
    return this.toResult(result.post_id ?? result.id, pageId);
  }

  private async publishVideo(
    pageId: string,
    token: string,
    url: string,
    message: string,
  ): Promise<PublishResult> {
    const result = await graphPost<{ id: string; post_id?: string }>(
      this.platform,
      `${pageId}/videos`,
      { file_url: url, description: message, access_token: token },
    );
    return this.toResult(result.post_id ?? result.id, pageId);
  }

  /**
   * Multi-photo posts are assembled, not uploaded as a set: each photo is
   * uploaded unpublished first, then a single feed post references them all.
   * Publishing them individually would spam the page with separate posts.
   */
  private async publishMultiPhoto(
    pageId: string,
    token: string,
    request: PublishRequest,
    message: string,
  ): Promise<PublishResult> {
    const photos = request.media.filter((m) => m.type === "IMAGE");
    if (photos.length !== request.media.length) {
      throw new PlatformError(
        "A Facebook multi-photo post cannot mix images and video",
        { platform: this.platform, code: "MIXED_MEDIA", retryable: false },
      );
    }

    const attachedMedia: string[] = [];
    for (const photo of photos) {
      const uploaded = await graphPost<{ id: string }>(
        this.platform,
        `${pageId}/photos`,
        { url: photo.url, published: "false", access_token: token },
      );
      attachedMedia.push(JSON.stringify({ media_fbid: uploaded.id }));
    }

    const form: Record<string, string> = { message, access_token: token };
    attachedMedia.forEach((entry, index) => {
      form[`attached_media[${index}]`] = entry;
    });

    const result = await graphPost<{ id: string }>(this.platform, `${pageId}/feed`, form);
    return this.toResult(result.id, pageId);
  }

  private async publishStory(
    pageId: string,
    token: string,
    request: PublishRequest,
  ): Promise<PublishResult> {
    const media = request.media[0];
    if (!media) {
      throw new PlatformError("A Facebook story requires one media item", {
        platform: this.platform,
        code: "NO_MEDIA",
        retryable: false,
      });
    }

    if (media.type === "IMAGE") {
      // Photo stories are a two-step upload: stage the photo unpublished, then
      // promote the resulting id to a story.
      const uploaded = await graphPost<{ id: string }>(
        this.platform,
        `${pageId}/photos`,
        { url: media.url, published: "false", access_token: token },
      );
      const story = await graphPost<{ post_id?: string; id?: string }>(
        this.platform,
        `${pageId}/photo_stories`,
        { photo_id: uploaded.id, access_token: token },
      );
      return this.toResult(story.post_id ?? story.id ?? uploaded.id, pageId);
    }

    const story = await graphPost<{ post_id?: string; id?: string }>(
      this.platform,
      `${pageId}/video_stories`,
      { video_url: media.url, upload_phase: "finish", access_token: token },
    );
    return this.toResult(story.post_id ?? story.id ?? "", pageId);
  }

  private toResult(postId: string, pageId: string): PublishResult {
    return {
      externalPostId: postId,
      permalink: postId.includes("_")
        ? `https://www.facebook.com/${postId.replace("_", "/posts/")}`
        : `https://www.facebook.com/${pageId}`,
      effectiveVisibility: Visibility.PUBLIC,
      warnings: [],
    };
  }

  async fetchPostMetrics(
    tokens: TokenSet,
    _account: AccountIdentity,
    externalPostId: string,
  ): Promise<NormalisedMetrics> {
    const response = await fetchInsightsResilient(
      this.platform,
      `${externalPostId}/insights`,
      [
        "post_impressions",
        "post_impressions_unique",
        "post_engaged_users",
        "post_clicks",
        "post_reactions_by_type_total",
        "post_video_views",
        "post_video_view_time",
      ],
      { access_token: tokens.accessToken },
    );
    const metrics = flattenInsights(response);

    const engagement = await graphGet<{
      shares?: { count?: number };
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
    }>(this.platform, externalPostId, {
      fields:
        "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)",
      access_token: tokens.accessToken,
    }).catch(() => ({}) as Record<string, never>);

    const watchTimeMs = metrics.post_video_view_time;

    return {
      reach: metrics.post_impressions_unique ?? null,
      impressions: metrics.post_impressions ?? null,
      likes: engagement.reactions?.summary?.total_count ?? null,
      comments: engagement.comments?.summary?.total_count ?? null,
      shares: engagement.shares?.count ?? null,
      // Facebook Pages expose no per-post save count.
      saves: null,
      videoViews: metrics.post_video_views ?? null,
      watchTimeSec: watchTimeMs !== undefined ? watchTimeMs / 1000 : null,
      linkClicks: metrics.post_clicks ?? null,
      raw: { insights: metrics, engagement },
    };
  }

  async fetchAccountMetrics(
    tokens: TokenSet,
    account: AccountIdentity,
  ): Promise<AccountMetrics> {
    const profile = await graphGet<{ followers_count?: number; fan_count?: number }>(
      this.platform,
      account.externalId,
      { fields: "followers_count,fan_count", access_token: tokens.accessToken },
    );

    const insights = await fetchInsightsResilient(
      this.platform,
      `${account.externalId}/insights`,
      ["page_impressions", "page_impressions_unique", "page_views_total"],
      { period: "day", access_token: tokens.accessToken },
    )
      .then(flattenInsights)
      .catch(() => ({}) as Record<string, number>);

    return {
      followerCount: profile.followers_count ?? profile.fan_count ?? null,
      reach: insights.page_impressions_unique ?? null,
      impressions: insights.page_impressions ?? null,
      profileVisits: insights.page_views_total ?? null,
      raw: { profile, insights },
    };
  }

  /**
   * Facebook Pages have no published per-account posting quota endpoint, so
   * this is a self-imposed ceiling rather than a platform-reported one. It sits
   * well below any rate at which Meta starts flagging automated posting.
   */
  async fetchPublishingQuota(): Promise<PublishingQuota> {
    return { used: null, total: 50, windowSeconds: 86_400, source: "fallback" };
  }

  mediaConstraints(): MediaConstraints {
    return {
      image: {
        maxSizeBytes: 10 * 1024 * 1024,
        minAspectRatio: 0.1,
        maxAspectRatio: 10,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/gif"],
      },
      video: {
        maxSizeBytes: 4 * 1024 * 1024 * 1024,
        minDurationSec: 1,
        maxDurationSec: 7200,
        minAspectRatio: 0.1,
        maxAspectRatio: 10,
        allowedMimeTypes: ["video/mp4", "video/quicktime"],
      },
      maxCarouselItems: 10,
      maxCaptionLength: 63206,
    };
  }
}

/** Maps a Meta login's pages to Facebook Page accounts. */
export function facebookAccountsFrom(
  pages: MetaPage[],
  expiresAt: Date | null,
): ConnectedAccount[] {
  return pages.map((page) => ({
    externalId: page.id,
    username: null,
    displayName: page.name,
    avatarUrl: page.avatarUrl ?? null,
    linkedPageId: page.id,
    linkedPageName: page.name,
    tokens: { accessToken: page.accessToken, expiresAt, scopes: metaScopes() },
  }));
}
