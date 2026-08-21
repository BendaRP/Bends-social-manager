import { Platform } from "@prisma/client";
import type { PlatformAdapter } from "./types";
import { InstagramAdapter } from "./meta/instagram";
import { FacebookAdapter } from "./meta/facebook";
import { TikTokAdapter } from "./tiktok";
import { getEnv } from "@/lib/env";

/**
 * Adapter registry — the single place the rest of the system asks "how do I
 * talk to this network".
 *
 * Swapping an implementation (for instance, routing TikTok through a
 * third-party provider while waiting on the platform audit) is a change to this
 * function and nothing else.
 */
export function getAdapter(
  platform: Platform,
  options: { isAudited?: boolean } = {},
): PlatformAdapter {
  switch (platform) {
    case Platform.INSTAGRAM:
      return new InstagramAdapter();
    case Platform.FACEBOOK:
      return new FacebookAdapter();
    case Platform.TIKTOK:
      // Two independent switches must both be on before TikTok will post
      // publicly: the per-account audit flag and the deployment-wide env var.
      // Either one off keeps posts Self-only.
      return new TikTokAdapter(
        (options.isAudited ?? false) && getEnv().TIKTOK_CLIENT_AUDITED,
      );
    default: {
      const exhaustive: never = platform;
      throw new Error(`No adapter registered for platform ${exhaustive}`);
    }
  }
}

export * from "./types";
