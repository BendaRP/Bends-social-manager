import { NextResponse, type NextRequest } from "next/server";
import { Platform } from "@prisma/client";
import { consumeState } from "@/server/oauth-state";
import { getAdapter } from "@/platforms";
import { upsertAccount } from "@/server/accounts";
import { audit } from "@/server/auth";
import { getEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const appUrl = getEnv().APP_URL;

  const error = params.get("error_description") ?? params.get("error");
  if (error) {
    return redirect(appUrl, "error", `TikTok refused the connection: ${error}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return redirect(appUrl, "error", "TikTok returned an incomplete response");
  }

  const stored = await consumeState(state);
  if (!stored || stored.platform !== "tiktok") {
    return redirect(
      appUrl,
      "error",
      "This login link has expired or was not started here. Try connecting again.",
    );
  }

  try {
    const accounts = await getAdapter(Platform.TIKTOK).exchangeCode(
      code,
      stored.codeVerifier,
    );

    for (const account of accounts) {
      const { tokens, ...identity } = account;
      const saved = await upsertAccount({
        platform: Platform.TIKTOK,
        identity,
        tokens,
      });
      await audit(stored.userId, "account.connected", "SocialAccount", saved.id, {
        platform: "TIKTOK",
        username: identity.username,
      });
    }

    return redirect(appUrl, "success", "חשבון טיקטוק חובר בהצלחה");
  } catch (caught) {
    return redirect(appUrl, "error", (caught as Error).message);
  }
}

function redirect(appUrl: string, kind: "success" | "error", message: string) {
  const url = new URL("/connections", appUrl);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}
