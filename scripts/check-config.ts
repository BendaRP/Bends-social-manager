// Must come first: populates process.env before anything reads it.
import "../src/lib/load-env";
import { getEnv } from "../src/lib/env";
import { prisma } from "../src/server/db";
import { getRedis } from "../src/server/redis";
import { verifyPubliclyReachable } from "../src/server/storage";

/**
 * Pre-flight check.
 *
 * Run before relying on the system to publish anything:
 *   npm run check
 *
 * Every item here is a failure mode that otherwise only shows up at the moment
 * a scheduled post was supposed to go out, which is the worst time to find it.
 */
async function main(): Promise<void> {
  const results: Array<{ ok: boolean; label: string; detail?: string }> = [];

  const check = async (label: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      results.push({ ok: true, label, detail: detail ?? undefined });
    } catch (error) {
      results.push({ ok: false, label, detail: (error as Error).message });
    }
  };

  await check("משתני סביבה", async () => {
    const env = getEnv();
    return `אזור זמן ${env.AUDIENCE_TIMEZONE}, אישור ידני ${env.REQUIRE_MANUAL_APPROVAL ? "פעיל" : "כבוי"}`;
  });

  await check("חיבור לבסיס הנתונים", async () => {
    const accounts = await prisma.socialAccount.count();
    const posts = await prisma.post.count();
    return `${accounts} חשבונות, ${posts} פוסטים`;
  });

  await check("חיבור ל-Redis", async () => {
    const pong = await getRedis().ping();
    return pong;
  });

  await check("מפתח הצפנה", async () => {
    const { encrypt, decrypt } = await import("../src/lib/crypto");
    const probe = "round-trip-probe";
    if (decrypt(encrypt(probe).cipher) !== probe) {
      throw new Error("ההצפנה לא מחזירה את הערך המקורי");
    }
    return "תקין";
  });

  await check("הגדרות Meta", async () => {
    const env = getEnv();
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new Error("META_APP_ID או META_APP_SECRET חסרים");
    }
    return `גרסת Graph API ${env.META_GRAPH_VERSION}`;
  });

  await check("הגדרות TikTok", async () => {
    const env = getEnv();
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new Error("TIKTOK_CLIENT_KEY או TIKTOK_CLIENT_SECRET חסרים");
    }
    return env.TIKTOK_CLIENT_AUDITED
      ? "מסומן כמאושר (Audit עבר)"
      : "לא מאושר — פרסום ב-Self-only בלבד";
  });

  // The single most common cause of a failed publish, and invisible until it
  // happens: the bucket works from the browser but not anonymously.
  await check("נגישות ציבורית של האחסון", async () => {
    const env = getEnv();
    if (!env.S3_PUBLIC_BASE_URL) throw new Error("S3_PUBLIC_BASE_URL לא מוגדר");

    const latest = await prisma.mediaAsset.findFirst({ orderBy: { createdAt: "desc" } });
    if (!latest) return "אין עדיין מדיה לבדיקה — יתבצע אימות בהעלאה הראשונה";

    const result = await verifyPubliclyReachable(latest.publicUrl);
    if (!result.reachable) throw new Error(result.reason ?? "לא נגיש");
    return "המדיה נגישה ללא הרשאות, כנדרש";
  });

  console.log("");
  for (const result of results) {
    console.log(
      `${result.ok ? "✓" : "✗"} ${result.label}${result.detail ? ` — ${result.detail}` : ""}`,
    );
  }

  const failures = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(failures === 0 ? "הכל תקין." : `${failures} בעיות דורשות טיפול.`);

  await prisma.$disconnect();
  getRedis().disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
