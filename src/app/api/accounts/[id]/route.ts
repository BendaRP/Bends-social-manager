import { NextResponse } from "next/server";
import { AccountStatus } from "@prisma/client";
import { requireUser, audit } from "@/server/auth";
import { prisma } from "@/server/db";
import { handleApiError } from "@/lib/api";

/**
 * Disconnects an account.
 *
 * The row is kept and the credentials wiped, rather than deleting it: the
 * published posts and their metric history reference this account, and that
 * history is exactly what the recommendation engine will need later.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    await prisma.socialAccount.update({
      where: { id },
      data: {
        status: AccountStatus.REVOKED,
        accessTokenCipher: "",
        refreshTokenCipher: null,
        tokenExpiresAt: null,
        scopes: [],
      },
    });

    await audit(user.id, "account.disconnected", "SocialAccount", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
