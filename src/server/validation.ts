import { PostFormat, type Platform } from "@prisma/client";
import type { MediaConstraints, MediaInput } from "@/platforms/types";

/**
 * Pre-flight validation.
 *
 * Every rule here is one the platform would enforce anyway — the point is to
 * enforce them at compose time, when the user can still fix the problem, rather
 * than at publish time when the post is already late.
 */

export interface ValidationIssue {
  severity: "error" | "warning";
  platform: Platform;
  field: string;
  message: string;
}

export interface ValidationInput {
  platform: Platform;
  format: PostFormat;
  caption: string;
  hashtags: string[];
  media: MediaInput[];
  constraints: MediaConstraints;
  supportedFormats: PostFormat[];
}

export function validatePost(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { platform, format, constraints } = input;

  const error = (field: string, message: string) =>
    issues.push({ severity: "error", platform, field, message });
  const warn = (field: string, message: string) =>
    issues.push({ severity: "warning", platform, field, message });

  if (!input.supportedFormats.includes(format)) {
    error("format", `${platform} does not support the ${format} format`);
  }

  // --- Caption ------------------------------------------------------------
  const fullCaption = [
    input.caption,
    input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (fullCaption.length > constraints.maxCaptionLength) {
    error(
      "caption",
      `Caption is ${fullCaption.length} characters including hashtags; ` +
        `${platform} allows ${constraints.maxCaptionLength}`,
    );
  }

  if (constraints.maxHashtags && input.hashtags.length > constraints.maxHashtags) {
    error(
      "hashtags",
      `${input.hashtags.length} hashtags exceeds the ${platform} limit of ${constraints.maxHashtags}`,
    );
  }

  // --- Media presence -----------------------------------------------------
  if (format !== PostFormat.TEXT && input.media.length === 0) {
    error("media", `A ${format} post needs at least one media item`);
  }

  if (format === PostFormat.CAROUSEL) {
    const max = constraints.maxCarouselItems ?? 10;
    if (input.media.length < 2) {
      error("media", "A carousel needs at least 2 items");
    } else if (input.media.length > max) {
      error("media", `A ${platform} carousel allows at most ${max} items, got ${input.media.length}`);
    }
  }

  if (
    format !== PostFormat.CAROUSEL &&
    format !== PostFormat.TEXT &&
    input.media.length > 1
  ) {
    warn("media", `A ${format} post uses only the first media item; the rest are ignored`);
  }

  // --- Per-item media rules ----------------------------------------------
  input.media.forEach((media, index) => {
    const label = `media[${index}]`;

    if (media.type === "IMAGE" && constraints.image) {
      const rules = constraints.image;
      if (!rules.allowedMimeTypes.includes(media.mimeType)) {
        error(label, `${platform} does not accept ${media.mimeType} images (allowed: ${rules.allowedMimeTypes.join(", ")})`);
      }
      if (media.sizeBytes > rules.maxSizeBytes) {
        error(label, `Image is ${formatBytes(media.sizeBytes)}; ${platform} allows up to ${formatBytes(rules.maxSizeBytes)}`);
      }
      const ratio = aspectRatioOf(media);
      if (ratio !== null && (ratio < rules.minAspectRatio || ratio > rules.maxAspectRatio)) {
        error(
          label,
          `Aspect ratio ${ratio.toFixed(2)} is outside the ${platform} range ` +
            `${rules.minAspectRatio}–${rules.maxAspectRatio}. Crop the image before posting.`,
        );
      }
    }

    if (media.type === "VIDEO" && constraints.video) {
      const rules = constraints.video;
      if (!rules.allowedMimeTypes.includes(media.mimeType)) {
        error(label, `${platform} does not accept ${media.mimeType} video (allowed: ${rules.allowedMimeTypes.join(", ")})`);
      }
      if (media.sizeBytes > rules.maxSizeBytes) {
        error(label, `Video is ${formatBytes(media.sizeBytes)}; ${platform} allows up to ${formatBytes(rules.maxSizeBytes)}`);
      }
      if (media.durationSec != null) {
        if (media.durationSec < rules.minDurationSec) {
          error(label, `Video is ${media.durationSec.toFixed(1)}s; ${platform} requires at least ${rules.minDurationSec}s`);
        }
        if (media.durationSec > rules.maxDurationSec) {
          error(label, `Video is ${Math.round(media.durationSec)}s; ${platform} allows at most ${rules.maxDurationSec}s`);
        }
      }
    }
  });

  return issues;
}

function aspectRatioOf(media: MediaInput): number | null {
  if (!media.width || !media.height) return null;
  return media.width / media.height;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024).toFixed(0)}KB`;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
