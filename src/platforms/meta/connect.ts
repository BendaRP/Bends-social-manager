import { Platform } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { PlatformError } from "../types";
import { exchangeForLongLivedToken, graphGet } from "./client";

/**
 * The Meta login exchange, shared by both adapters.
 *
 * A Facebook authorisation code can only be redeemed once, so the exchange
 * happens here and both the Instagram accounts and the Facebook Pages are
 * derived from its single result. Letting each adapter redeem the code
 * separately would make whichever ran second fail.
 */

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  avatarUrl?: string | null;
  instagram?: {
    id: string;
    username?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  };
}

export interface MetaLoginResult {
  pages: MetaPage[];
  expiresAt: Date | null;
}

export async function exchangeMetaLogin(code: string): Promise<MetaLoginResult> {
  const env = getEnv();

  const shortLived = await graphGet<{ access_token: string }>(
    Platform.FACEBOOK,
    "oauth/access_token",
    {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: `${env.APP_URL}/api/auth/meta/callback`,
      code,
    },
  );

  const longLived = await exchangeForLongLivedToken(
    Platform.FACEBOOK,
    shortLived.access_token,
  );

  const { pages, notes } = await discoverPages(longLived.accessToken);

  // No pages at all and no pages-without-Instagram are different failures with
  // different fixes, and conflating them sends the user to change the wrong
  // setting. Only the genuinely empty case is fatal here; a page with no linked
  // Instagram account is still a perfectly usable Facebook connection, so the
  // caller decides what to do about it.
  if (pages.length === 0) {
    throw await noPagesError(longLived.accessToken, notes);
  }

  return { pages, expiresAt: longLived.expiresAt };
}

const PAGE_FIELDS =
  "id,name,access_token,picture{url}," +
  "instagram_business_account{id,username,name,profile_picture_url}";

/**
 * Finds every Page this login can publish to.
 *
 * `/me/accounts` alone is not enough. It lists Pages the person holds a direct
 * role on, but a Page owned by a Business Portfolio can be granted to an app
 * through the business without the person ever holding that direct role — the
 * asset picker shows the Page, the permissions are granted, and `/me/accounts`
 * still comes back empty. That combination is common for real businesses and
 * looks identical to having no Page at all.
 *
 * So the business-owned Pages are enumerated too, and the results merged. Each
 * lookup is independent and failure-tolerant: the business edges need
 * `business_management`, which this app does not request by default, and its
 * absence must degrade discovery rather than break the connection.
 */
async function discoverPages(
  accessToken: string,
): Promise<{ pages: MetaPage[]; notes: string[] }> {
  const collected = new Map<string, MetaPage>();
  const notes: string[] = [];

  // --- Direct roles ------------------------------------------------------
  try {
    const direct = await graphGet<PagesResponse>(Platform.FACEBOOK, "me/accounts", {
      fields: PAGE_FIELDS,
      access_token: accessToken,
      limit: "100",
    });
    const found = direct.data ?? [];
    notes.push(`me/accounts: ${found.length}`);
    for (const page of found) collected.set(page.id, toMetaPage(page));
  } catch (error) {
    notes.push(`me/accounts נכשל: ${(error as Error).message}`);
  }

  if (collected.size > 0) {
    return { pages: [...collected.values()], notes };
  }

  // --- Business-owned ----------------------------------------------------
  let businessIds: string[] = [];
  try {
    const businesses = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(
      Platform.FACEBOOK,
      "me/businesses",
      { fields: "id,name", access_token: accessToken, limit: "50" },
    );
    businessIds = (businesses.data ?? []).map((b) => b.id);
    notes.push(`me/businesses: ${businessIds.length}`);
  } catch {
    notes.push(
      "me/businesses לא זמין (דורש את ההרשאה business_management)",
    );
  }

  for (const businessId of businessIds) {
    for (const edge of ["owned_pages", "client_pages"] as const) {
      try {
        const result = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(
          Platform.FACEBOOK,
          `${businessId}/${edge}`,
          { fields: "id,name", access_token: accessToken, limit: "100" },
        );
        const found = result.data ?? [];
        notes.push(`${edge}: ${found.length}`);

        // These edges do not return a page access token, and publishing needs
        // one, so each page is re-read individually to obtain it.
        for (const page of found) {
          if (collected.has(page.id)) continue;
          try {
            const full = await graphGet<RawPage>(Platform.FACEBOOK, page.id, {
              fields: PAGE_FIELDS,
              access_token: accessToken,
            });
            if (full.access_token) collected.set(full.id, toMetaPage(full));
            else notes.push(`אין טוקן פרסום לעמוד ${page.name ?? page.id}`);
          } catch (error) {
            notes.push(`קריאת העמוד ${page.name ?? page.id} נכשלה: ${(error as Error).message}`);
          }
        }
      } catch {
        notes.push(`${edge} לא זמין`);
      }
    }
  }

  return { pages: [...collected.values()], notes };
}

function toMetaPage(page: RawPage): MetaPage {
  return {
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
    avatarUrl: page.picture?.data?.url ?? null,
    instagram: page.instagram_business_account
      ? {
          id: page.instagram_business_account.id,
          username: page.instagram_business_account.username ?? null,
          name: page.instagram_business_account.name ?? null,
          avatarUrl: page.instagram_business_account.profile_picture_url ?? null,
        }
      : undefined,
  };
}

/**
 * Builds the "no pages" error by asking Meta what it actually granted.
 *
 * An empty page list has several unrelated causes — the permission was
 * declined, no page was selected during the asset-picker step, or the account
 * administers no page at all — and they are indistinguishable from the empty
 * list alone. Meta will say which permissions it granted and declined, so ask
 * rather than presenting the user with a list of guesses to work through.
 */
async function noPagesError(
  accessToken: string,
  notes: string[],
): Promise<PlatformError> {
  const granted: string[] = [];
  const declined: string[] = [];
  let loginName: string | null = null;

  try {
    const permissions = await graphGet<{
      data?: Array<{ permission: string; status: string }>;
    }>(Platform.FACEBOOK, "me/permissions", { access_token: accessToken });

    for (const entry of permissions.data ?? []) {
      if (entry.status === "granted") granted.push(entry.permission);
      else declined.push(entry.permission);
    }
  } catch {
    // Diagnostics are best-effort; never let them replace the real error.
  }

  try {
    const me = await graphGet<{ name?: string }>(Platform.FACEBOOK, "me", {
      fields: "name",
      access_token: accessToken,
    });
    loginName = me.name ?? null;
  } catch {
    // Ignore.
  }

  const lines = ["לא נמצא אף עמוד פייסבוק בחשבון שאיתו התחברת."];
  if (loginName) lines.push(`התחברת כ: ${loginName}`);

  if (!granted.includes("pages_show_list")) {
    // This is decisive: without the permission Meta returns an empty list no
    // matter how many pages the account administers.
    lines.push(
      "הסיבה: ההרשאה pages_show_list לא אושרה, ובלעדיה Meta מחזירה רשימה ריקה " +
        "גם אם יש לך עמודים. יש להתחבר שוב ולאשר את הגישה לעמודים.",
    );
  } else {
    lines.push(
      "ההרשאה pages_show_list אושרה, אבל אף מקור לא החזיר עמוד. " +
        "הסיבה השכיחה: העמוד שייך ל-Business Portfolio ולפרופיל שלך אין עליו תפקיד ישיר. " +
        "התיקון: בהגדרות העמוד ← 'גישה לעמוד' (Page access) ← להוסיף את עצמך כמנהל ישיר, " +
        "ואז לחבר כאן מחדש. לחלופין אפשר לאשר את ההרשאה business_management " +
        "(META_SCOPES ב-.env) כדי לאתר עמודים דרך העסק.",
    );
  }

  if (notes.length > 0) lines.push(`מקורות שנבדקו: ${notes.join("; ")}`);
  if (declined.length > 0) lines.push(`הרשאות שנדחו: ${declined.join(", ")}`);
  if (granted.length > 0) lines.push(`הרשאות שאושרו: ${granted.join(", ")}`);

  return new PlatformError(lines.join(" | "), {
    platform: Platform.FACEBOOK,
    code: "NO_PAGES_GRANTED",
    retryable: false,
    raw: { granted, declined, notes },
  });
}

interface RawPage {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
}

interface PagesResponse {
  data?: RawPage[];
}
