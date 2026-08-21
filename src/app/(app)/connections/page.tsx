import { AccountStatus, Platform } from "@prisma/client";
import { prisma } from "@/server/db";
import { Card, Alert, PlatformBadge, Ltr } from "@/components/ui";
import { SCOPE_EXPLANATIONS, metaScopes, type MetaScope } from "@/platforms/meta/scopes";
import { formatAudience } from "@/lib/time";
import { getEnv } from "@/lib/env";
import { DisconnectButton } from "./disconnect-button";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; warning?: string }>;
}) {
  const params = await searchParams;
  const env = getEnv();
  const accounts = await prisma.socialAccount.findMany({ orderBy: { platform: "asc" } });

  const metaConfigured = Boolean(env.META_APP_ID);
  const tiktokConfigured = Boolean(env.TIKTOK_CLIENT_KEY);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">חשבונות מחוברים</h1>
        <p className="mt-1 text-sm text-ink-muted">
          חיבור אחד ל-Meta מחבר גם את האינסטגרם וגם את עמוד הפייסבוק המקושר אליו.
        </p>
      </header>

      {params.success && <Alert tone="success">{params.success}</Alert>}
      {params.warning && (
        <Alert tone="warning" title="חובר, עם הערה">
          {params.warning}
        </Alert>
      )}
      {params.error && <Alert tone="danger" title="החיבור נכשל">{params.error}</Alert>}

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              אינסטגרם ופייסבוק
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              דורש חשבון אינסטגרם מסוג Business או Creator שמקושר לעמוד פייסבוק.
            </p>
          </div>
          {metaConfigured ? (
            <a
              href="/api/auth/meta/start"
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              חיבור
            </a>
          ) : (
            <span className="shrink-0 rounded-lg bg-surface-muted px-4 py-2 text-sm text-ink-muted">
              לא מוגדר
            </span>
          )}
        </div>

        {!metaConfigured && (
          <div className="mt-4">
            <Alert tone="warning">
              חסרים <Ltr>META_APP_ID</Ltr> ו-<Ltr>META_APP_SECRET</Ltr> בהגדרות.
              המדריך המלא נמצא ב-<Ltr>docs/SETUP.md</Ltr>.
            </Alert>
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-muted">
            אילו הרשאות המערכת מבקשת ולמה
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {metaScopes().map((scope) => (
              <li key={scope} className="flex flex-col gap-0.5">
                <code className="text-xs text-brand" dir="ltr">{scope}</code>
                <span className="text-ink-muted">
                  {SCOPE_EXPLANATIONS[scope as MetaScope] ?? "הרשאה מותאמת אישית"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">
            המערכת לא מבקשת הרשאות לשינוי הגדרות העמוד או למחיקת תגובות — אלה לא נדרשות לפרסום.
          </p>
        </details>
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">טיקטוק</h2>
            <p className="mt-1 text-sm text-ink-muted">
              דורש חשבון <Ltr>TikTok Business</Ltr>.
            </p>
          </div>
          {tiktokConfigured ? (
            <a
              href="/api/auth/tiktok/start"
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              חיבור
            </a>
          ) : (
            <span className="shrink-0 rounded-lg bg-surface-muted px-4 py-2 text-sm text-ink-muted">
              לא מוגדר
            </span>
          )}
        </div>

        <div className="mt-4">
          <Alert tone="warning" title="מגבלת Self-only — שלב צפוי, לא תקלה">
            <p>
              עד שאפליקציית ה-API שלנו תעבור <Ltr>Audit</Ltr> רשמי מול טיקטוק:
            </p>
            <ul className="mt-2 list-disc space-y-1 pe-5">
              <li>כל פוסט יפורסם במצב <Ltr>Self-only</Ltr> — גלוי רק לך.</li>
              <li>
                חשבון הטיקטוק עצמו חייב להיות מוגדר <strong>פרטי</strong> ברגע הפרסום, אחרת
                טיקטוק ידחה את הבקשה.
              </li>
              <li>
                פוסטים שיפורסמו במצב הזה <strong>לא יהפכו לציבוריים רטרואקטיבית</strong> אחרי
                שה-Audit יאושר — יהיה צריך לפרסם אותם מחדש.
              </li>
            </ul>
          </Alert>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-ink">חשבונות פעילים</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted">עוד לא חובר אף חשבון.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-4 py-3">
                <PlatformBadge platform={account.platform} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {account.username ?? account.displayName ?? account.externalId}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {account.platform === Platform.INSTAGRAM && account.linkedPageName && (
                      <>מקושר לעמוד {account.linkedPageName} · </>
                    )}
                    {account.status === AccountStatus.CONNECTED ? (
                      account.tokenExpiresAt ? (
                        <>הרשאה בתוקף עד {formatAudience(account.tokenExpiresAt, { dateStyle: "medium" })}</>
                      ) : (
                        "מחובר"
                      )
                    ) : (
                      <span className="text-danger">
                        {account.lastError ?? account.status}
                      </span>
                    )}
                  </p>
                </div>
                {account.platform === Platform.TIKTOK && !account.isAudited && (
                  <span className="shrink-0 rounded-md bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    Self-only
                  </span>
                )}
                <DisconnectButton accountId={account.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
