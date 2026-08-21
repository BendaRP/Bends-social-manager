import { NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { requireUser } from "@/server/auth";
import { createState } from "@/server/oauth-state";
import { getAdapter } from "@/platforms";
import { getEnv } from "@/lib/env";

/**
 * Starts the Meta login. One flow connects both the Facebook Page and the
 * Instagram professional account linked to it — Instagram publishing is
 * authorised by the page token, so they cannot be connected separately.
 */
export async function GET() {
  const user = await requireUser();
  const env = getEnv();

  if (!env.META_APP_ID) {
    return NextResponse.json(
      { error: "META_APP_ID is not configured. See docs/SETUP.md." },
      { status: 400 },
    );
  }

  const state = await createState({ platform: "meta", userId: user.id });
  const url = getAdapter(Platform.INSTAGRAM).buildAuthorizationUrl(state);
  return NextResponse.redirect(url);
}
