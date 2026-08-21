import { NextResponse, type NextRequest } from "next/server";
import { Platform } from "@prisma/client";
import { consumeState } from "@/server/oauth-state";
import { getAdapter } from "@/platforms";
import { upsertAccount } from "@/server/accounts";
import { audit } from "@/server/auth";
import { getEnv } from "@/lib/env";

/**
 * Meta OAuth callback.
 *
 * Connects every Instagram professional account reachable through the login,
 * plus the Facebook Pages themselves. Connecting all of them and letting the
 * user pick per post is friendlier than making them repeat the login once per
 * account.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const appUrl = getEnv().APP_URL;

  const error = params.get("error_description") ?? params.get("error");
  if (error) {
    return redirectWithMessage(appUrl, "error", `Meta refused the connection: ${error}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return redirectWithMessage(appUrl, "error", "Meta returned an incomplete response");
  }

  // Rejecting an unknown state is what prevents someone else's login being
  // grafted onto this installation.
  const stored = await consumeState(state);
  if (!stored || stored.platform !== "meta") {
    return redirectWithMessage(
      appUrl,
      "error",
      "This login link has expired or was not started here. Try connecting again.",
    );
  }

  try {
    const instagramAccounts = await getAdapter(Platform.INSTAGRAM).exchangeCode(code);
    for (const account of instagramAccounts) {
      const { tokens, ...identity } = account;
      const saved = await upsertAccount({
        platform: Platform.INSTAGRAM,
        identity,
        tokens,
      });
      await audit(stored.userId, "account.connected", "SocialAccount", saved.id, {
        platform: "INSTAGRAM",
        username: identity.username,
      });
    }

    // The Facebook exchange reuses the same authorisation code, which Meta
    // permits only once — so the pages are derived from the accounts already
    // fetched rather than exchanged a second time.
    const facebookAdapter = getAdapter(Platform.FACEBOOK);
    const pages = new Map<string, (typeof instagramAccounts)[number]>();
    for (const account of instagramAccounts) {
      if (account.linkedPageId) pages.set(account.linkedPageId, account);
    }

    for (const [pageId, account] of pages) {
      const saved = await upsertAccount({
        platform: Platform.FACEBOOK,
        identity: {
          externalId: pageId,
          displayName: account.linkedPageName ?? null,
          linkedPageId: pageId,
          linkedPageName: account.linkedPageName ?? null,
        },
        tokens: account.tokens,
      });
      await audit(stored.userId, "account.connected", "SocialAccount", saved.id, {
        platform: "FACEBOOK",
        page: account.linkedPageName,
      });
    }

    void facebookAdapter;

    return redirectWithMessage(
      appUrl,
      "success",
      `חוברו ${instagramAccounts.length} חשבונות אינסטגרם ו-${pages.size} עמודי פייסבוק`,
    );
  } catch (caught) {
    return redirectWithMessage(appUrl, "error", (caught as Error).message);
  }
}

function redirectWithMessage(appUrl: string, kind: "success" | "error", message: string) {
  const url = new URL("/connections", appUrl);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}
