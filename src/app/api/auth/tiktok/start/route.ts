import { NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { requireUser } from "@/server/auth";
import { createState } from "@/server/oauth-state";
import { getAdapter } from "@/platforms";
import { createPkcePair } from "@/platforms/tiktok";
import { getEnv } from "@/lib/env";

export async function GET() {
  const user = await requireUser();
  const env = getEnv();

  if (!env.TIKTOK_CLIENT_KEY) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_KEY is not configured. See docs/SETUP.md." },
      { status: 400 },
    );
  }

  // The verifier stays server-side; only its hash travels to TikTok.
  const { verifier, challenge } = createPkcePair();
  const state = await createState({
    platform: "tiktok",
    userId: user.id,
    codeVerifier: verifier,
  });

  const url = getAdapter(Platform.TIKTOK).buildAuthorizationUrl(state, challenge);
  return NextResponse.redirect(url);
}
