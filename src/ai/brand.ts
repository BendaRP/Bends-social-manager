import type { BrandProfile } from "@prisma/client";
import { prisma } from "@/server/db";

/** Single-row profile; the id is fixed so there is nothing to look up by. */
export const BRAND_ID = "default";

export async function getBrandProfile(): Promise<BrandProfile | null> {
  return prisma.brandProfile.findUnique({ where: { id: BRAND_ID } });
}

export async function requireBrandProfile(): Promise<BrandProfile> {
  const brand = await getBrandProfile();
  if (!brand) {
    throw new Error(
      "עדיין לא הוגדר פרופיל מותג. יש למלא אותו במסך 'זהות המותג' לפני יצירת תוכן.",
    );
  }
  return brand;
}

/**
 * Turns the brand profile into the system prompt.
 *
 * Written as a description of the business rather than a list of rules for a
 * writer, because that is what actually shapes voice: a model told "you are a
 * social media expert, write engaging content" produces the generic register
 * every brand already sounds like. Concrete facts about this business, its
 * audience, and the words it does and does not use produce copy that sounds
 * like this business.
 *
 * Kept byte-stable across calls so it can be cached — the brief varies, this
 * does not.
 */
export function buildBrandSystemPrompt(brand: BrandProfile): string {
  const sections: string[] = [];

  sections.push(
    `אתה כותב תוכן לרשתות החברתיות של העסק "${brand.businessName}".`,
    "",
    "## על העסק",
    brand.description,
    "",
    "## קהל היעד",
    brand.audience,
  );

  if (brand.toneWords.length > 0) {
    sections.push("", "## הטון", `הכתיבה צריכה להישמע: ${brand.toneWords.join(", ")}.`);
  }

  if (brand.voiceNotes) {
    sections.push("", "## הנחיות נוספות לקול המותג", brand.voiceNotes);
  }

  if (brand.preferWords.length > 0) {
    sections.push("", "## מילים ומונחים להעדיף", brand.preferWords.join(", "));
  }

  if (brand.avoidWords.length > 0) {
    sections.push(
      "",
      "## מילים ומונחים להימנע מהם",
      brand.avoidWords.join(", "),
      "אלה מילים שהמותג הזה לא משתמש בהן. אל תשתמש בהן גם לא בווריאציות.",
    );
  }

  if (brand.contentPillars.length > 0) {
    sections.push("", "## קטגוריות התוכן של המותג", brand.contentPillars.join(", "));
  }

  sections.push(
    "",
    "## כללי כתיבה",
    `- שפת הכתיבה: ${brand.language === "he" ? "עברית" : brand.language}.`,
    brand.useEmoji
      ? "- אימוג'ים מותרים במידה, כשהם מוסיפים משמעות."
      : "- בלי אימוג'ים.",
    "- בלי קלישאות שיווקיות ובלי הבטחות גורפות.",
    "- לכתוב כמו בן אדם שמדבר על העסק שלו, לא כמו פרסומת.",
    "- השורה הראשונה היא מה שמכריע אם ממשיכים לקרוא. שאל שאלה, אמור משהו",
    "  ספציפי, או פתח באמצע סיפור — אל תפתח בהצהרה כללית.",
    "- לא להמציא עובדות על העסק שלא נמסרו לך. אם חסר מידע — לכתוב בלעדיו.",
  );

  return sections.join("\n");
}

/**
 * Platform-specific guidance.
 *
 * The same idea genuinely needs different shapes: what reads as thorough on
 * Facebook reads as a wall of text on Instagram, and TikTok captions are read
 * while the video is already playing.
 */
export const PLATFORM_GUIDANCE: Record<string, string> = {
  INSTAGRAM: [
    "אינסטגרם: עד 2200 תווים כולל האשטגים, אבל רק השורה הראשונה נראית לפני",
    "'עוד' — היא צריכה לעמוד בפני עצמה. 3-8 האשטגים רלוונטיים, לא 30 גנריים.",
    "רווחי שורה בין פסקאות, טקסט קצר ונושם.",
  ].join(" "),
  FACEBOOK: [
    "פייסבוק: אפשר טקסט ארוך ומפורט יותר, והקהל נוטה מבוגר יותר.",
    "האשטגים כמעט לא עוזרים שם — מקסימום 1-2, או בכלל לא. קישורים כן עובדים.",
  ].join(" "),
  TIKTOK: [
    "טיקטוק: כיתוב קצר מאוד, עד 150 תווים בפועל. הוא נקרא בזמן שהסרטון כבר רץ,",
    "אז הוא צריך להוסיף הקשר או לחדד — לא לחזור על מה שרואים. 3-5 האשטגים.",
  ].join(" "),
};
