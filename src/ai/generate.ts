import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BrandProfile } from "@prisma/client";
import { prisma } from "@/server/db";
import { CONTENT_MODEL, getClaude } from "./client";
import { PLATFORM_GUIDANCE, buildBrandSystemPrompt } from "./brand";

/**
 * Content generation.
 *
 * Every call returns a schema-validated object rather than prose to be parsed,
 * so a malformed response fails here instead of producing a draft with a
 * caption in the hashtag field.
 */

// --- Schemas ---------------------------------------------------------------

const PlatformCaptionSchema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

const PostDraftSchema = z.object({
  title: z.string().describe("כותרת פנימית קצרה לזיהוי הפוסט ביומן. לא מפורסמת."),
  contentPillar: z.string().describe("קטגוריית התוכן של הפוסט"),
  captions: z.array(PlatformCaptionSchema),
});

const CarouselSlideSchema = z.object({
  kicker: z.string().nullable().describe("מילה או שתיים מעל הכותרת. אפשר null."),
  headline: z.string().describe("הכותרת הראשית של השקופית. קצרה ככל האפשר."),
  body: z.string().nullable().describe("משפט הסבר. אפשר null בשקופית פתיחה."),
});

const CarouselSchema = z.object({
  title: z.string(),
  contentPillar: z.string(),
  slides: z.array(CarouselSlideSchema),
  caption: z.string().describe("הכיתוב שילווה את הקרוסלה בפוסט"),
  hashtags: z.array(z.string()),
});

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      hook: z.string().describe("השורה הראשונה שתופסת את העין"),
      angle: z.string().describe("במשפט: מה הזווית של הפוסט"),
      format: z.enum(["SINGLE_IMAGE", "CAROUSEL", "REEL", "TEXT"]),
      contentPillar: z.string(),
    }),
  ),
});

export type PostDraft = z.infer<typeof PostDraftSchema>;
export type Carousel = z.infer<typeof CarouselSchema>;
export type Ideas = z.infer<typeof IdeasSchema>;

// --- Generation ------------------------------------------------------------

interface GenerateOptions {
  brand: BrandProfile;
  brief: string;
  platforms: Array<"INSTAGRAM" | "FACEBOOK" | "TIKTOK">;
}

/** Writes one post, with a caption tailored to each destination platform. */
export async function generatePostDraft(options: GenerateOptions): Promise<PostDraft> {
  const { brand, brief, platforms } = options;

  const guidance = platforms
    .map((platform) => `- ${PLATFORM_GUIDANCE[platform] ?? platform}`)
    .join("\n");

  const response = await getClaude().messages.parse({
    model: CONTENT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    // The brand prompt is identical on every call and the brief is not, so the
    // stable half is cached and only the brief is charged at full rate.
    system: [
      {
        type: "text",
        text: buildBrandSystemPrompt(brand),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          `כתוב פוסט על הנושא הבא:`,
          "",
          brief,
          "",
          `הפוסט מיועד לפלטפורמות: ${platforms.join(", ")}.`,
          "כתוב גרסה נפרדת לכל אחת — לא את אותו טקסט פעמיים. הן נקראות אחרת:",
          guidance,
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(PostDraftSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("המודל לא החזיר תוצאה בפורמט הצפוי");

  await recordGeneration(brand.id, "post", brief, response.usage, parsed);
  return parsed;
}

/**
 * Writes a carousel: the slide copy plus the caption that accompanies it.
 *
 * Slide count is constrained because carousel slides are read in about a
 * second each — long ones are scrolled past, and Instagram caps a carousel at
 * ten items regardless.
 */
export async function generateCarousel(
  options: GenerateOptions & { slideCount?: number },
): Promise<Carousel> {
  const { brand, brief } = options;
  const slideCount = Math.min(Math.max(options.slideCount ?? 6, 3), 10);

  const response = await getClaude().messages.parse({
    model: CONTENT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: buildBrandSystemPrompt(brand),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          `בנה קרוסלה של ${slideCount} שקופיות על הנושא:`,
          "",
          brief,
          "",
          "מבנה:",
          "- שקופית 1 היא הפתיח. כותרת אחת חזקה שגורמת להחליק הלאה, בלי גוף טקסט.",
          "- השקופיות באמצע: רעיון אחד בכל אחת. כותרת קצרה ומשפט הסבר.",
          "- השקופית האחרונה: סיכום או קריאה לפעולה.",
          "",
          "אילוצים קשיחים — השקופיות מעוצבות בתבנית ולכן הטקסט חייב להיכנס:",
          "- כותרת: עד 42 תווים. קצר יותר תמיד נראה טוב יותר.",
          "- גוף: עד 120 תווים.",
          "- kicker: עד 20 תווים, או null.",
          "טקסט ארוך מזה יגלוש מהעיצוב ויקוצץ.",
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(CarouselSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("המודל לא החזיר קרוסלה בפורמט הצפוי");

  await recordGeneration(brand.id, "carousel", brief, response.usage, parsed);
  return parsed;
}

/** Proposes post ideas, for when the brief is "what should I post this week". */
export async function generateIdeas(
  brand: BrandProfile,
  brief: string,
  count = 5,
): Promise<Ideas> {
  const response = await getClaude().messages.parse({
    model: CONTENT_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: buildBrandSystemPrompt(brand),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          `הצע ${count} רעיונות לפוסטים.`,
          brief ? `\nהקשר: ${brief}` : "",
          "\nשיהיו מגוונים בפורמט ובזווית — לא חמש וריאציות על אותו רעיון.",
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(IdeasSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("המודל לא החזיר רעיונות בפורמט הצפוי");

  await recordGeneration(brand.id, "ideas", brief, response.usage, parsed);
  return parsed;
}

/**
 * Records what was generated and what it cost.
 *
 * Token spend is otherwise invisible until the bill arrives, and a draft with
 * no record of the brief that produced it cannot be regenerated or debugged.
 */
async function recordGeneration(
  brandId: string,
  kind: string,
  brief: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  output: unknown,
): Promise<void> {
  await prisma.generation
    .create({
      data: {
        brandId,
        kind,
        brief,
        model: CONTENT_MODEL,
        output: output as object,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
      },
    })
    .catch((error: unknown) => {
      // Bookkeeping must never lose the user the content they just generated.
      console.warn(`[ai] failed to record generation: ${(error as Error).message}`);
    });
}
