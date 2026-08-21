import Link from "next/link";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { Card, EmptyState, PlatformBadge, StatusBadge, Ltr } from "@/components/ui";
import { dayNameHe, formatAudience, localParts, audienceTimezone } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Content calendar.
 *
 * Grouped by local day rather than shown as a flat list: the question this
 * screen answers is "what is going out this week and is anything clustered
 * badly", and a chronological list makes that hard to see.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const params = await searchParams;
  const weeks = Math.min(Math.max(Number(params.weeks ?? 4), 1), 12);

  const now = new Date();
  const from = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const to = new Date(now.getTime() + weeks * 7 * 24 * 3600 * 1000);

  const posts = await prisma.post.findMany({
    where: {
      OR: [
        { scheduledAt: { gte: from, lte: to } },
        { publishedAt: { gte: from, lte: to } },
      ],
      status: { not: PostStatus.CANCELLED },
    },
    orderBy: [{ scheduledAt: "asc" }, { publishedAt: "asc" }],
    include: { targets: { include: { account: true } } },
  });

  // Group by local calendar day. Doing this in the audience timezone matters:
  // a post at 00:30 Israel time is 21:30 UTC the previous day, and would land
  // on the wrong row if grouped by the UTC date.
  const byDay = new Map<string, typeof posts>();
  for (const post of posts) {
    const when = post.scheduledAt ?? post.publishedAt;
    if (!when) continue;
    const parts = localParts(when);
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.dayOfMonth).padStart(2, "0")}`;
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">יומן תוכן</h1>
          <p className="mt-1 text-sm text-ink-muted">
            שבועיים אחורה ו-<Ltr>{weeks}</Ltr> שבועות קדימה, בשעון{" "}
            <Ltr>{audienceTimezone()}</Ltr>
          </p>
        </div>
        <div className="flex gap-1">
          {[2, 4, 8].map((option) => (
            <Link
              key={option}
              href={`/calendar?weeks=${option}`}
              className={
                weeks === option
                  ? "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-ink-muted hover:border-brand hover:text-brand"
              }
            >
              <Ltr>{option}</Ltr> שבועות
            </Link>
          ))}
        </div>
      </header>

      {days.length === 0 ? (
        <EmptyState
          title="היומן ריק"
          description="פוסטים מתוזמנים ופוסטים שפורסמו יופיעו כאן, מקובצים לפי יום."
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
        days.map(([key, dayPosts]) => {
          const first = dayPosts[0]!;
          const when = first.scheduledAt ?? first.publishedAt!;
          const parts = localParts(when);
          const isToday = key === todayKey();

          return (
            <Card key={key} className={isToday ? "border-brand" : undefined}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-ink">
                  יום {dayNameHe(parts.dayOfWeek)}
                </h2>
                <span className="text-sm text-ink-muted">
                  {formatAudience(when, { dateStyle: "long" })}
                </span>
                {parts.isWeekend && (
                  <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                    סוף שבוע
                  </span>
                )}
                {isToday && (
                  <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs text-brand">
                    היום
                  </span>
                )}
              </div>

              <ul className="divide-y divide-border-subtle">
                {dayPosts.map((post) => {
                  const at = post.scheduledAt ?? post.publishedAt!;
                  return (
                    <li key={post.id} className="flex items-center gap-4 py-3">
                      <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-ink-muted">
                        {formatAudience(at, { timeStyle: "short" })}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">
                          {post.title ?? (post.caption.slice(0, 60) || "ללא כותרת")}
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
            </Card>
          );
        })
      )}
    </div>
  );
}

function todayKey(): string {
  const parts = localParts(new Date());
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.dayOfMonth).padStart(2, "0")}`;
}
