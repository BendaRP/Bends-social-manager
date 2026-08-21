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
    throw new PlatformError(
      "לא נמצא אף עמוד פייסבוק בחשבון הזה. שתי סיבות אפשריות: " +
        "(1) במסך ההרשאות של פייסבוק לא נבחר אף עמוד — יש להתחבר שוב ולוודא שהעמוד מסומן; " +
        "(2) אינך מוגדר כמנהל של אף עמוד עסקי. " +
        "אפשר לבדוק ב-https://www.facebook.com/pages/?category=your_pages",
      { platform: Platform.FACEBOOK, code: "NO_PAGES_GRANTED", retryable: false },
    );
  }

  return { pages, expiresAt: longLived.expiresAt };
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
