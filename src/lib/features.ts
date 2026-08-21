import type { PostFormat, Platform } from "@prisma/client";
import { localParts } from "./time";

/**
 * Feature extraction for the learning substrate.
 *
 * Nothing in phase 1 reads these values. They are recorded at publish time so
 * that when the recommendation engine arrives it has real history to work with
 * — a model added later cannot retroactively know what time of day a post from
 * three months ago went out, or how long its caption was.
 */

/** Hebrew and Latin call-to-action markers. */
const CTA_PATTERNS = [
  /\b(link in bio|swipe|tap|click|comment|share|save this|follow|dm|sign up|shop now)\b/i,
  /(קישור בביו|לחצו|לחץ|הגיבו|שתפו|שמרו|עקבו|הירשמו|בואו|תייגו|ספרו לי)/,
];

const QUESTION_PATTERNS = [/\?/, /؟/];

// Matches emoji across the pictographic ranges, including ZWJ sequences and
// skin-tone modifiers, so a single composed emoji counts once.
const EMOJI_REGEX =
  /(\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?(‍\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?)*)/gu;

const HASHTAG_REGEX = /#[\p{L}\p{N}_]+/gu;
const MENTION_REGEX = /@[\p{L}\p{N}_.]+/gu;
const URL_REGEX = /https?:\/\/[^\s]+/gi;

export interface CaptionFeatures {
  captionLength: number;
  wordCount: number;
  hashtagCount: number;
  hashtags: string[];
  mentionCount: number;
  emojiCount: number;
  hasCallToAction: boolean;
  hasLink: boolean;
  hasQuestion: boolean;
}

export function extractCaptionFeatures(
  caption: string,
  extraHashtags: string[] = [],
): CaptionFeatures {
  const text = caption ?? "";

  const inlineHashtags = Array.from(text.matchAll(HASHTAG_REGEX), (m) =>
    m[0].slice(1).toLowerCase(),
  );
  const normalisedExtra = extraHashtags.map((h) =>
    h.replace(/^#/, "").toLowerCase(),
  );
  const hashtags = Array.from(new Set([...inlineHashtags, ...normalisedExtra]));

  // Word count excludes hashtags, mentions and URLs: 30 trailing hashtags
  // should not read as a 30-word caption.
  const prose = text
    .replace(HASHTAG_REGEX, " ")
    .replace(MENTION_REGEX, " ")
    .replace(URL_REGEX, " ")
    .trim();

  return {
    captionLength: text.length,
    wordCount: prose.length === 0 ? 0 : prose.split(/\s+/).length,
    hashtagCount: hashtags.length,
    hashtags,
    mentionCount: Array.from(text.matchAll(MENTION_REGEX)).length,
    emojiCount: Array.from(text.matchAll(EMOJI_REGEX)).length,
    hasCallToAction: CTA_PATTERNS.some((p) => p.test(text)),
    hasLink: URL_REGEX.test(text),
    hasQuestion: QUESTION_PATTERNS.some((p) => p.test(text)),
  };
}

export interface BuildFeaturesInput {
  platform: Platform;
  format: PostFormat;
  publishedAt: Date;
  caption: string;
  hashtags: string[];
  mediaCount: number;
  videoDurationSec?: number | null;
  aspectRatio?: number | null;
  contentPillar?: string | null;
  followerCountAtPublish?: number | null;
  isHoliday?: boolean;
}

/** Assembles the full feature row written alongside every published post. */
export function buildPostFeatures(input: BuildFeaturesInput) {
  const caption = extractCaptionFeatures(input.caption, input.hashtags);
  const time = localParts(input.publishedAt);

  return {
    platform: input.platform,
    format: input.format,
    publishedAtUtc: input.publishedAt,
    localHour: time.hour,
    localMinute: time.minute,
    localDayOfWeek: time.dayOfWeek,
    localDayOfMonth: time.dayOfMonth,
    localMonth: time.month,
    isWeekend: time.isWeekend,
    isHoliday: input.isHoliday ?? false,
    ...caption,
    mediaCount: input.mediaCount,
    videoDurationSec: input.videoDurationSec ?? null,
    aspectRatio: input.aspectRatio ?? null,
    contentPillar: input.contentPillar ?? null,
    followerCountAtPublish: input.followerCountAtPublish ?? null,
  };
}

/**
 * Engagement rate against reach, which is the comparison that survives follower
 * growth. Returns null rather than 0 when reach is unknown, so "not measured
 * yet" never averages in as "performed terribly".
 */
export function computeEngagementRate(metrics: {
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
}): number | null {
  const reach = metrics.reach ?? 0;
  if (reach <= 0) return null;
  const interactions =
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.saves ?? 0);
  return interactions / reach;
}
