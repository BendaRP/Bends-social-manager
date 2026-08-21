import { NextResponse, type NextRequest } from "next/server";
import { Platform } from "@prisma/client";
import { consumeState } from "@/server/oauth-state";
import { exchangeMetaLogin } from "@/platforms/meta/connect";
import { instagramAccountsFrom } from "@/platforms/meta/instagram";
import { facebookAccountsFrom } from "@/platforms/meta/facebook";
import { upsertAccount } from "@/server/accounts";
import { audit } from "@/server/auth";
import { getEnv } from "@/lib/env";

/**
 * Meta OAuth callback.
 *
 * One login yields both the Facebook Pages and any Instagram professional
 * accounts linked to them, so the authorisation code is redeemed once here and
 * both sets are derived from that single result — Meta rejects a second
 * redemption of the same code.
 *
 * Pages connect whether or not an Instagram account is linked. Publishing to a
 * Page needs no Instagram at all, so refusing the whole connection over a
 * missing Instagram link would withhold a feature that works for a reason that
 * does not apply to it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const appUrl = getEnv().APP_URL;

  const error = params.get("error_description") ?? params.get("error");
  if (error) {
    return redirectWith(appUrl, "error", `Meta refused the connection: ${error}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return redirectWith(appUrl, "error", "Meta returned an incomplete response");
  }

  // Rejecting an unknown state is what prevents someone else's login being
  // grafted onto this installation.
  const stored = await consumeState(state);
  if (!stored || stored.platform !== "meta") {
    return redirectWith(
      appUrl,
      "error",
      "קישור ההתחברות פג או לא נפתח מכאן. נסה לחבר שוב.",
    );
  }

  try {
    const { pages, expiresAt } = await exchangeMetaLogin(code);

    const facebookAccounts = facebookAccountsFrom(pages, expiresAt);
    const instagramAccounts = instagramAccountsFrom(pages, expiresAt);

    for (const account of facebookAccounts) {
      const { tokens, ...identity } = account;
      const saved = await upsertAccount({ platform: Platform.FACEBOOK, identity, tokens });
      await audit(stored.userId, "account.connected", "SocialAccount", saved.id, {
        platform: "FACEBOOK",
        page: identity.displayName,
      });
    }

    for (const account of instagramAccounts) {
      const { tokens, ...identity } = account;
      const saved = await upsertAccount({ platform: Platform.INSTAGRAM, identity, tokens });
      await audit(stored.userId, "account.connected", "SocialAccount", saved.id, {
        platform: "INSTAGRAM",
        username: identity.username,
      });
    }

    const summary = `חוברו ${facebookAccounts.length} עמודי פייסבוק ו-${instagramAccounts.length} חשבונות אינסטגרם.`;

    // Connected, but Instagram publishing will not work — say so plainly and
    // exactly once, at the moment it is discoverable and fixable.
    if (instagramAccounts.length === 0) {
      const pageNames = pages.map((p) => p.name).join(", ");
      return redirectWith(
        appUrl,
        "warning",
        `${summary} לא נמצא חשבון אינסטגרם מקצועי המקושר לעמודים (${pageNames}). ` +
          `אפשר לפרסם לפייסבוק כרגיל. כדי לפרסם גם לאינסטגרם: להפוך את חשבון האינסטגרם ` +
          `ל-Business או Creator, ולקשר אותו לעמוד דרך הגדרות העמוד ← "חשבונות מקושרים", ` +
          `ואז לחבר כאן מחדש.`,
      );
    }

    return redirectWith(appUrl, "success", summary);
  } catch (caught) {
    return redirectWith(appUrl, "error", (caught as Error).message);
  }
}

function redirectWith(
  appUrl: string,
  kind: "success" | "error" | "warning",
  message: string,
) {
  const url = new URL("/connections", appUrl);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}
