import type { Platform, SocialAccount } from "@prisma/client";
import { AccountStatus } from "@prisma/client";
import { prisma } from "./db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getAdapter } from "@/platforms";
import type { AccountIdentity, TokenSet } from "@/platforms/types";

/**
 * The only place that decrypts stored credentials.
 *
 * Keeping decryption behind this one module means every token read is
 * deliberate and auditable, rather than scattered across route handlers where
 * a plaintext token could easily end up in a log line.
 */

export function toIdentity(account: SocialAccount): AccountIdentity {
  return {
    externalId: account.externalId,
    username: account.username,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    linkedPageId: account.linkedPageId,
    linkedPageName: account.linkedPageName,
  };
}

export function loadTokens(account: SocialAccount): TokenSet {
  return {
    accessToken: decrypt(account.accessTokenCipher),
    refreshToken: account.refreshTokenCipher
      ? decrypt(account.refreshTokenCipher)
      : null,
    expiresAt: account.tokenExpiresAt,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt,
    scopes: account.scopes,
  };
}

export async function saveTokens(
  accountId: string,
  tokens: TokenSet,
): Promise<void> {
  const access = encrypt(tokens.accessToken);
  const refresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

  await prisma.socialAccount.update({
    where: { id: accountId },
    data: {
      accessTokenCipher: access.cipher,
      refreshTokenCipher: refresh?.cipher ?? null,
      encryptionKeyId: access.keyId,
      tokenExpiresAt: tokens.expiresAt ?? null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      scopes: tokens.scopes,
      status: AccountStatus.CONNECTED,
      lastError: null,
      lastCheckedAt: new Date(),
    },
  });
}

export interface UpsertAccountInput {
  platform: Platform;
  identity: AccountIdentity;
  tokens: TokenSet;
}

export async function upsertAccount(input: UpsertAccountInput): Promise<SocialAccount> {
  const access = encrypt(input.tokens.accessToken);
  const refresh = input.tokens.refreshToken
    ? encrypt(input.tokens.refreshToken)
    : null;

  const shared = {
    username: input.identity.username ?? null,
    displayName: input.identity.displayName ?? null,
    avatarUrl: input.identity.avatarUrl ?? null,
    linkedPageId: input.identity.linkedPageId ?? null,
    linkedPageName: input.identity.linkedPageName ?? null,
    accessTokenCipher: access.cipher,
    refreshTokenCipher: refresh?.cipher ?? null,
    encryptionKeyId: access.keyId,
    tokenExpiresAt: input.tokens.expiresAt ?? null,
    refreshTokenExpiresAt: input.tokens.refreshTokenExpiresAt ?? null,
    scopes: input.tokens.scopes,
    status: AccountStatus.CONNECTED,
    lastError: null,
    lastCheckedAt: new Date(),
  };

  return prisma.socialAccount.upsert({
    where: {
      platform_externalId: {
        platform: input.platform,
        externalId: input.identity.externalId,
      },
    },
    create: { platform: input.platform, externalId: input.identity.externalId, ...shared },
    update: shared,
  });
}

/**
 * Renews a token that is close to expiry, before it becomes a problem.
 *
 * Refreshing a week ahead rather than on the day leaves room for several failed
 * attempts (a platform outage, a temporary network problem) before the
 * connection would actually break and posts would start failing.
 */
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function ensureFreshTokens(
  account: SocialAccount,
): Promise<TokenSet> {
  const tokens = loadTokens(account);

  const expiresAt = tokens.expiresAt?.getTime();
  if (!expiresAt || expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return tokens;
  }

  const adapter = getAdapter(account.platform, { isAudited: account.isAudited });

  try {
    const refreshed = await adapter.refreshTokens(tokens);
    if (!refreshed) return tokens;
    await saveTokens(account.id, refreshed);
    return refreshed;
  } catch (error) {
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        status:
          expiresAt <= Date.now()
            ? AccountStatus.TOKEN_EXPIRED
            : AccountStatus.ERROR,
        lastError: `Token refresh failed: ${(error as Error).message}`,
        lastCheckedAt: new Date(),
      },
    });

    // An expired token cannot publish; surface that rather than letting the
    // publish attempt fail with a confusing platform error.
    if (expiresAt <= Date.now()) throw error;
    return tokens;
  }
}
