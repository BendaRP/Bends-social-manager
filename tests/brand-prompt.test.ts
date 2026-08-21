import { describe, expect, it } from "vitest";
import type { BrandProfile } from "@prisma/client";
import { buildBrandSystemPrompt, PLATFORM_GUIDANCE } from "@/ai/brand";

function brand(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    id: "default",
    businessName: "Couples Corner",
    description: "חנות מתנות לזוגות",
    audience: "זוגות צעירים בגילי 25-40",
    toneWords: ["חם", "ישיר"],
    voiceNotes: null,
    preferWords: [],
    avoidWords: [],
    contentPillars: [],
    language: "he",
    colorPrimary: "#2D2A32",
    colorAccent: "#E4572E",
    colorBackground: "#FAF7F2",
    colorText: "#2D2A32",
    logoUrl: null,
    useEmoji: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BrandProfile;
}

describe("brand system prompt", () => {
  it("carries the business facts through", () => {
    const prompt = buildBrandSystemPrompt(brand());
    expect(prompt).toContain("Couples Corner");
    expect(prompt).toContain("חנות מתנות לזוגות");
    expect(prompt).toContain("זוגות צעירים");
    expect(prompt).toContain("חם, ישיר");
  });

  it("states forbidden words as a prohibition, not a preference", () => {
    // A list of words under a neutral heading reads as vocabulary to consider.
    // The instruction has to be explicit or the model treats it as optional.
    const prompt = buildBrandSystemPrompt(brand({ avoidWords: ["מהפכני", "פורץ דרך"] }));
    expect(prompt).toContain("מהפכני");
    expect(prompt).toContain("להימנע");
    expect(prompt).toMatch(/לא משתמש בהן/);
  });

  it("omits sections that have no content", () => {
    // Empty headings invite the model to fill them in.
    const prompt = buildBrandSystemPrompt(
      brand({ toneWords: [], preferWords: [], avoidWords: [], contentPillars: [] }),
    );
    expect(prompt).not.toContain("## הטון");
    expect(prompt).not.toContain("## מילים ומונחים להימנע מהם");
    expect(prompt).not.toContain("## קטגוריות התוכן של המותג");
  });

  it("turns the emoji setting into an explicit instruction either way", () => {
    expect(buildBrandSystemPrompt(brand({ useEmoji: true }))).toContain("אימוג'ים מותרים");
    expect(buildBrandSystemPrompt(brand({ useEmoji: false }))).toContain("בלי אימוג'ים");
  });

  it("is byte-stable for the same profile, so it can be cached", () => {
    // The prompt is sent with cache_control; any per-call variation would make
    // every request a cache miss and quietly triple the input cost.
    const profile = brand();
    expect(buildBrandSystemPrompt(profile)).toBe(buildBrandSystemPrompt(profile));
  });

  it("has distinct guidance per platform", () => {
    const values = Object.values(PLATFORM_GUIDANCE);
    expect(new Set(values).size).toBe(values.length);
    expect(PLATFORM_GUIDANCE.TIKTOK).toContain("קצר");
    expect(PLATFORM_GUIDANCE.FACEBOOK).toMatch(/האשטגים כמעט לא עוזרים/);
  });
});
