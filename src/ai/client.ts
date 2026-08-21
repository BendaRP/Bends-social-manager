import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";

/**
 * Claude client for content generation.
 *
 * Constructed lazily: the rest of the system publishes and schedules perfectly
 * well without an API key, so a missing key must fail only when generation is
 * actually requested, not at boot.
 */

let client: Anthropic | null = null;

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "יצירת תוכן ב-AI לא מוגדרת. יש להוסיף ANTHROPIC_API_KEY לקובץ .env — " +
        "המפתח נוצר ב-https://console.anthropic.com/settings/keys",
    );
    this.name = "AiNotConfiguredError";
  }
}

export function isAiConfigured(): boolean {
  return Boolean(getEnv().ANTHROPIC_API_KEY);
}

export function getClaude(): Anthropic {
  const key = getEnv().ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfiguredError();
  client ??= new Anthropic({ apiKey: key });
  return client;
}

/**
 * The model used for content generation.
 *
 * Configurable because the cost/quality trade-off is the owner's to make, not
 * a default to impose. Opus 5 writes the best copy; Haiku 4.5 costs roughly a
 * fifth as much and is a reasonable choice for high-volume drafting where
 * every result gets edited anyway.
 */
export function contentModel(): string {
  return getEnv().CONTENT_MODEL || "claude-opus-5";
}
