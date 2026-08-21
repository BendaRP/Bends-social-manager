import Link from "next/link";
import { AccountStatus, PostStatus, TargetStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { Card, EmptyState, PlatformBadge, StatusBadge, Alert, Ltr } from "@/components/ui";
import { formatAudience, dayNameHe, localParts } from "@/lib/time";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const env = getEnv();

  const [accounts, pending, upcoming, recent, failedTargets] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { platform: "asc" } }),
    prisma.post.count({ where: { status: PostStatus.PENDING_APPROVAL } }),
    prisma.post.findMany({
      where: {
        status: { in: [PostStatus.SCHEDULED, PostStatus.APPROVED] },
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
      take: 5,
      include: { targets: { include: { account: true } } },
    }),
    prisma.post.findMany({
      where: { status: { in: [PostStatus.PUBLISHED, PostStatus.PARTIALLY_PUBLISHED] } },
      orderBy: { publishedAt: "desc" },
      take: 5,
      include: { targets: { include: { account: true } } },
    }),
    prisma.postTarget.findMany({
      where: { status: TargetStatus.FAILED },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { account: true, post: true },
    }),
  ]);

  const connected = accounts.filter((a) => a.status === AccountStatus.CONNECTED);
  const needsAttention = accounts.filter((a) => a.status !== AccountStatus.CONNECTED);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">לוח בקרה</h1>
        <p className="mt-1 text-sm text-ink-muted">
          כל השעות מוצגות בשעון{" "}
          <Ltr>{env.AUDIENCE_TIMEZONE}</Ltr>
        </p>
      </header>

      {connected.length === 0 && (
        <Alert tone="info" title="עוד לא חיברת חשבונות">
          כדי להתחיל לפרסם צריך לחבר לפחות חשבון אחד.{" "}
          <Link href="/connections" className="font-medium underline">
            למסך החשבונות
          </Link>
        </Alert>
      )}

      {needsAttention.length > 0 && (
        <Alert tone="warning" title="חשבונות שדורשים טיפול">
          <ul className="space-y-1">
            {needsAttention.map((account) => (
              <li key={account.id}>
                <PlatformBadge platform={account.platform} />{" "}
                {account.username ?? account.displayName} — {account.lastError ?? account.status}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-ink-muted">חשבונות מחוברים</p>
          <p className="mt-1 text-3xl font-semibold text-ink">{connected.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-muted">ממתין לאישורך</p>
          <p className="mt-1 text-3xl font-semibold text-ink">{pending}</p>
          {pending > 0 && (
            <Link href="/approvals" className="mt-2 inline-block text-sm font-medium text-brand">
              לאישור →
            </Link>
          )}
        </Card>
        <Card>
          <p className="text-sm text-ink-muted">מתוזמן לפרסום</p>
          <p className="mt-1 text-3xl font-semibold text-ink">{upcoming.length}</p>
        </Card>
      </div>

      {failedTargets.length > 0 && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-danger">פרסומים שנכשלו</h2>
          <ul className="space-y-3">
            {failedTargets.map((target) => (
              <li key={target.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <PlatformBadge platform={target.account.platform} />
                  <span className="font-medium text-ink">
                    {target.post.title ?? (target.post.caption.slice(0, 40) || "ללא כותרת")}
                  </span>
                </div>
                <p className="mt-1 text-ink-muted">{target.lastError}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-base font-semibold text-ink">הפרסומים הקרובים</h2>
        {upcoming.length === 0 ? (
          <EmptyState
            title="אין פוסטים מתוזמנים"
            description="פוסטים שתיצור ותאשר יופיעו כאן עם מועד הפרסום שלהם."
            action={
              <Link
                href="/compose"
                className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
              >
                יצירת פוסט
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {upcoming.map((post) => {
              const when = post.scheduledAt;
              const parts = when ? localParts(when) : null;
              return (
                <li key={post.id} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {post.title ?? (post.caption.slice(0, 60) || "ללא כותרת")}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {when && parts
                        ? `יום ${dayNameHe(parts.dayOfWeek)}, ${formatAudience(when)}`
                        : "ללא מועד"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {post.targets.map((t) => (
                      <PlatformBadge key={t.id} platform={t.account.platform} />
                    ))}
                  </div>
                  <StatusBadge status={post.status} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-ink">פורסם לאחרונה</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-muted">עוד לא פורסמו פוסטים דרך המערכת.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {recent.map((post) => (
              <li key={post.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {post.title ?? (post.caption.slice(0, 60) || "ללא כותרת")}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {post.publishedAt ? formatAudience(post.publishedAt) : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {post.targets.map((t) => (
                    <PlatformBadge key={t.id} platform={t.account.platform} />
                  ))}
                </div>
                <StatusBadge status={post.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
