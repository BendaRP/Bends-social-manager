import { describe, expect, it } from "vitest";
import { Platform, PostFormat } from "@prisma/client";
import { hasBlockingIssues, validatePost } from "@/server/validation";
import { InstagramAdapter } from "@/platforms/meta/instagram";
import type { MediaInput } from "@/platforms/types";

const instagram = new InstagramAdapter();

function image(overrides: Partial<MediaInput> = {}): MediaInput {
  return {
    type: "IMAGE",
    url: "https://media.example.com/a.jpg",
    mimeType: "image/jpeg",
    width: 1080,
    height: 1080,
    sizeBytes: 500_000,
    ...overrides,
  };
}

function validate(format: PostFormat, media: MediaInput[], caption = "שלום", hashtags: string[] = []) {
  return validatePost({
    platform: Platform.INSTAGRAM,
    format,
    caption,
    hashtags,
    media,
    constraints: instagram.mediaConstraints(format),
    supportedFormats: instagram.supportedFormats,
  });
}

describe("Instagram pre-flight validation", () => {
  it("accepts a well-formed single image post", () => {
    expect(hasBlockingIssues(validate(PostFormat.SINGLE_IMAGE, [image()]))).toBe(false);
  });

  it("rejects an aspect ratio Instagram will not accept", () => {
    // 3:1 panorama — outside the 4:5 to 1.91:1 range.
    const issues = validate(PostFormat.SINGLE_IMAGE, [image({ width: 3000, height: 1000 })]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.some((i) => i.message.includes("Aspect ratio"))).toBe(true);
  });

  it("counts hashtags toward the caption length limit", () => {
    // The 2200-character cap applies to caption plus hashtags combined, which
    // is easy to miss when they are edited in separate fields.
    const issues = validate(PostFormat.SINGLE_IMAGE, [image()], "a".repeat(2190), ["averylonghashtag"]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.some((i) => i.field === "caption")).toBe(true);
  });

  it("enforces the 30-hashtag limit", () => {
    const hashtags = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    const issues = validate(PostFormat.SINGLE_IMAGE, [image()], "hi", hashtags);
    expect(issues.some((i) => i.field === "hashtags")).toBe(true);
  });

  it("requires between 2 and 10 items in a carousel", () => {
    expect(hasBlockingIssues(validate(PostFormat.CAROUSEL, [image()]))).toBe(true);
    expect(
      hasBlockingIssues(validate(PostFormat.CAROUSEL, Array.from({ length: 11 }, () => image()))),
    ).toBe(true);
    expect(
      hasBlockingIssues(validate(PostFormat.CAROUSEL, [image(), image()])),
    ).toBe(false);
  });

  it("rejects an oversized image", () => {
    const issues = validate(PostFormat.SINGLE_IMAGE, [image({ sizeBytes: 20 * 1024 * 1024 })]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("rejects an unsupported mime type", () => {
    const issues = validate(PostFormat.SINGLE_IMAGE, [image({ mimeType: "image/webp" })]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("warns rather than fails when extra media is ignored", () => {
    const issues = validate(PostFormat.SINGLE_IMAGE, [image(), image()]);
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });
});
