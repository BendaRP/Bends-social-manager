import { AccountStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureFreshTokens } from "@/server/accounts";

/**
 * Keeps connections alive.
 *
 * Meta long-lived tokens last about 60 days and TikTok's refresh tokens expire
 * too. Without this running on a schedule the whole system quietly stops
 * working roughly two months after setup — and the symptom would be a missed
 * post, not an obvious error.
 */
export async function runTokenRefreshJob(): Promise<void> {
  const accounts = await prisma.socialAccount.findMany({
    where: { status: { in: [AccountStatus.CONNECTED, AccountStatus.ERROR] } },
  });

  for (const account of accounts) {
    try {
      await ensureFreshTokens(account);
    } catch (error) {
      console.error(
        `[tokens] refresh failed for ${account.platform} (${account.username ?? account.externalId}): ` +
          `${(error as Error).message}`,
      );
    }
  }
}
