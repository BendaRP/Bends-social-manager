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

export const CONTENT_MODEL = "claude-opus-5";
