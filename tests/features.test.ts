import { describe, expect, it } from "vitest";
import {
  computeEngagementRate,
  extractCaptionFeatures,
  buildPostFeatures,
} from "@/lib/features";
import { Platform, PostFormat } from "@prisma/client";

describe("caption feature extraction", () => {
  it("counts hashtags from the caption and the separate list without duplicating", () => {
    const features = extractCaptionFeatures("בוקר טוב #קפה #בוקר", ["#קפה", "עסק"]);
    expect(features.hashtags.sort()).toEqual(["בוקר", "עסק", "קפה"]);
    expect(features.hashtagCount).toBe(3);
  });

  it("excludes hashtags and links from the word count", () => {
    // 30 trailing hashtags should not read as a long caption.
    const features = extractCaptionFeatures(
      "שתי מילים https://example.com #a #b #c #d",
    );
    expect(features.wordCount).toBe(2);
    expect(features.hasLink).toBe(true);
  });

  it("detects Hebrew and English calls to action", () => {
    expect(extractCaptionFeatures("קישור בביו").hasCallToAction).toBe(true);
    expect(extractCaptionFeatures("link in bio").hasCallToAction).toBe(true);
    expect(extractCaptionFeatures("just a photo").hasCallToAction).toBe(false);
  });

  it("counts composed emoji as one", () => {
    // A ZWJ family sequence is a single emoji to a reader.
    expect(extractCaptionFeatures("👨‍👩‍👧‍👦").emojiCount).toBe(1);
    expect(extractCaptionFeatures("🔥🔥 בוקר טוב").emojiCount).toBe(2);
  });

  it("detects questions", () => {
    expect(extractCaptionFeatures("מה דעתכם?").hasQuestion).toBe(true);
    expect(extractCaptionFeatures("זה נחמד").hasQuestion).toBe(false);
  });
});

describe("buildPostFeatures", () => {
  it("records local timing for the audience timezone", () => {
    const features = buildPostFeatures({
      platform: Platform.INSTAGRAM,
      format: PostFormat.REEL,
      publishedAt: new Date("2026-08-21T16:30:00Z"), // Friday 19:30 Israel time
      caption: "בדיקה",
      hashtags: ["test"],
      mediaCount: 1,
    });

    expect(features.localHour).toBe(19);
    expect(features.localDayOfWeek).toBe(5);
    expect(features.isWeekend).toBe(true);
    expect(features.platform).toBe(Platform.INSTAGRAM);
  });
});

describe("engagement rate", () => {
  it("divides interactions by reach", () => {
    expect(
      computeEngagementRate({ reach: 1000, likes: 80, comments: 10, shares: 5, saves: 5 }),
    ).toBeCloseTo(0.1);
  });

  it("returns null when reach is unknown so it does not average in as zero", () => {
    expect(computeEngagementRate({ reach: null, likes: 50 })).toBeNull();
    expect(computeEngagementRate({ reach: 0, likes: 50 })).toBeNull();
  });
});
