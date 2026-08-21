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

  const response = await graphGet<PagesResponse>(Platform.FACEBOOK, "me/accounts", {
    fields:
      "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
    access_token: longLived.accessToken,
    limit: "100",
  });

  const pages: MetaPage[] = (response.data ?? []).map((page) => ({
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
  }));

  // No pages at all and no pages-without-Instagram are different failures with
  // different fixes, and conflating them sends the user to change the wrong
  // setting. Only the genuinely empty case is fatal here; a page with no linked
  // Instagram account is still a perfectly usable Facebook connection, so the
  // caller decides what to do about it.
  if (pages.length === 0) {
    throw await noPagesError(longLived.accessToken);
  }

  return { pages, expiresAt: longLived.expiresAt };
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
async function noPagesError(accessToken: string): Promise<PlatformError> {
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
      "ההרשאה pages_show_list כן אושרה, כלומר Meta באמת לא רואה עמודים בחשבון הזה. " +
        "שתי אפשרויות: (1) במסך בחירת העמודים לא סומן אף עמוד — להתחבר שוב ולסמן; " +
        "(2) אין לך עמוד עסקי, או שאינך מנהל שלו. " +
        "לבדיקה: https://www.facebook.com/pages/?category=your_pages",
    );
  }

  if (declined.length > 0) lines.push(`הרשאות שנדחו: ${declined.join(", ")}`);
  if (granted.length > 0) lines.push(`הרשאות שאושרו: ${granted.join(", ")}`);

  return new PlatformError(lines.join(" | "), {
    platform: Platform.FACEBOOK,
    code: "NO_PAGES_GRANTED",
    retryable: false,
    raw: { granted, declined },
  });
}

interface PagesResponse {
  data?: Array<{
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
  }>;
}
