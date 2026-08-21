import { AccountStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { EmptyState } from "@/components/ui";
import Link from "next/link";
import { Composer } from "./composer";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const accounts = await prisma.socialAccount.findMany({
    where: { status: AccountStatus.CONNECTED },
    orderBy: { platform: "asc" },
  });

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="אין חשבונות מחוברים"
          description="כדי ליצור פוסט צריך לחבר לפחות חשבון אחד."
          action={
            <Link
              href="/connections"
              className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              למסך החשבונות
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">פוסט חדש</h1>
        <p className="mt-1 text-sm text-ink-muted">
          הפוסט יישמר כממתין לאישור. הוא לא יפורסם עד שתאשר אותו במסך האישורים.
        </p>
      </header>

      <Composer
        accounts={accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          label: a.username ?? a.displayName ?? a.externalId,
          isAudited: a.isAudited,
        }))}
      />
    </div>
  );
}
