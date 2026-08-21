import { PostStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { Card, EmptyState, PlatformBadge, Alert, Ltr } from "@/components/ui";
import { formatAudience, dayNameHe, localParts } from "@/lib/time";
import { ApprovalActions } from "./approval-actions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const posts = await prisma.post.findMany({
    where: { status: PostStatus.PENDING_APPROVAL },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    include: {
      targets: { include: { account: true } },
      media: { include: { media: true }, orderBy: { position: "asc" } },
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">ממתין לאישורך</h1>
        <p className="mt-1 text-sm text-ink-muted">
          שום פוסט לא יוצא לאוויר בלי שתאשר אותו כאן.
        </p>
      </header>

      {posts.length === 0 ? (
        <EmptyState
          title="אין פוסטים שממתינים לאישור"
          description="כל פוסט שתיצור יגיע לכאן ראשית, ורק אחרי אישור מפורש שלך ייכנס לתור הפרסום."
        />
      ) : (
        posts.map((post) => {
          const scheduled = post.scheduledAt;
          const parts = scheduled ? localParts(scheduled) : null;
          const tiktokTargets = post.targets.filter(
            (t) => t.account.platform === "TIKTOK" && !t.account.isAudited,
          );

          return (
            <Card key={post.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-ink">
                    {post.title ?? "ללא כותרת"}
                  </h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    {scheduled && parts ? (
                      <>
                        מתוזמן ליום {dayNameHe(parts.dayOfWeek)},{" "}
                        {formatAudience(scheduled)}
                      </>
                    ) : (
                      "יפורסם מיד עם האישור"
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {post.targets.map((t) => (
                    <PlatformBadge key={t.id} platform={t.account.platform} />
                  ))}
                </div>
              </div>

              {post.media.length > 0 && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {post.media.map((entry) => (
                    <div
                      key={entry.id}
                      className="size-24 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-surface-muted"
                    >
                      {entry.media.type === "IMAGE" ? (
                        <img
                          src={entry.media.publicUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <video
                          src={entry.media.publicUrl}
                          className="size-full object-cover"
                          muted
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {post.caption}
              </p>

              {post.hashtags.length > 0 && (
                <p className="mt-2 text-sm text-brand" dir="ltr">
                  {post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
                </p>
              )}

              {tiktokTargets.length > 0 && (
                <div className="mt-4">
                  <Alert tone="warning">
                    הפוסט לטיקטוק יפורסם במצב <Ltr>Self-only</Ltr> (גלוי רק לך), כי אפליקציית
                    ה-API עדיין לא עברה <Ltr>Audit</Ltr>. ודא שחשבון הטיקטוק מוגדר כפרטי,
                    אחרת הפרסום ייכשל.
                  </Alert>
                </div>
              )}

              <div className="mt-5 border-t border-border-subtle pt-4">
                <ApprovalActions postId={post.id} />
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
