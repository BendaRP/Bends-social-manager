"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Platform, PostFormat } from "@prisma/client";
import { Card, Alert, Ltr } from "@/components/ui";
import { MediaUploader, type UploadedMedia } from "./media-uploader";

interface AccountOption {
  id: string;
  platform: Platform;
  label: string;
  isAudited: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_IMAGE: "תמונה בודדת",
  CAROUSEL: "קרוסלה",
  REEL: "רילס",
  VIDEO: "וידאו",
  TEXT: "טקסט בלבד",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  INSTAGRAM: "אינסטגרם",
  FACEBOOK: "פייסבוק",
  TIKTOK: "טיקטוק",
};

/** Formats supported in phase 1. Stories arrive in phase 2. */
const FORMATS: PostFormat[] = [
  PostFormat.SINGLE_IMAGE,
  PostFormat.CAROUSEL,
  PostFormat.REEL,
  PostFormat.VIDEO,
  PostFormat.TEXT,
];

export function Composer({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();

  const [format, setFormat] = useState<PostFormat>(PostFormat.SINGLE_IMAGE);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtagText, setHashtagText] = useState("");
  const [contentPillar, setContentPillar] = useState("");
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ platform: string; message: string; severity: string }>>([]);

  const hashtags = useMemo(
    () =>
      hashtagText
        .split(/[\s,]+/)
        .map((h) => h.replace(/^#/, "").trim())
        .filter(Boolean),
    [hashtagText],
  );

  // The caption limit counts hashtags too, which is easy to miss when they are
  // typed in a separate box — so show the combined number.
  const combinedLength =
    caption.length + (hashtags.length ? hashtags.join(" ").length + hashtags.length + 2 : 0);

  const selectedAccounts = accounts.filter((a) => selected.includes(a.id));
  const unauditedTikTok = selectedAccounts.some(
    (a) => a.platform === Platform.TIKTOK && !a.isAudited,
  );

  function toggleAccount(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssues([]);

    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title || undefined,
        format,
        caption,
        hashtags,
        contentPillar: contentPillar || undefined,
        mediaIds: media.map((m) => m.id),
        scheduledAtLocal: scheduledAtLocal || null,
        targets: selected.map((accountId) => ({
          accountId,
          captionOverride: overrides[accountId] || undefined,
        })),
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(body.error ?? "שמירת הפוסט נכשלה");
      if (Array.isArray(body.issues)) setIssues(body.issues);
      setBusy(false);
      return;
    }

    router.push("/approvals");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card>
        <label className="mb-2 block text-sm font-medium text-ink">פורמט</label>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFormat(option)}
              className={
                format === option
                  ? "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-ink-muted hover:border-brand hover:text-brand"
              }
            >
              {FORMAT_LABELS[option] ?? option}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-ink">
            כותרת פנימית <span className="font-normal text-ink-muted">(לא מפורסמת — רק לזיהוי ביומן)</span>
          </label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
        </div>
      </Card>

      {format !== PostFormat.TEXT && (
        <Card>
          <label className="mb-2 block text-sm font-medium text-ink">מדיה</label>
          <p className="mb-3 text-xs text-ink-muted">
            {format === PostFormat.CAROUSEL
              ? "קרוסלה דורשת בין 2 ל-10 פריטים. הסדר כאן הוא סדר השקופיות."
              : "פריט אחד. תמונה בפורמט JPEG או PNG, וידאו בפורמט MP4."}
          </p>
          <MediaUploader media={media} onChange={setMedia} />
        </Card>
      )}

      <Card>
        <label htmlFor="caption" className="mb-1 block text-sm font-medium text-ink">
          כיתוב
        </label>
        <textarea
          id="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-brand"
        />
        <p className="mt-1 text-xs text-ink-muted">
          <Ltr>{combinedLength}</Ltr> תווים כולל האשטגים
          {combinedLength > 2200 && (
            <span className="text-danger"> — חורג ממגבלת אינסטגרם (2200)</span>
          )}
        </p>

        <div className="mt-4">
          <label htmlFor="hashtags" className="mb-1 block text-sm font-medium text-ink">
            האשטגים
          </label>
          <input
            id="hashtags"
            value={hashtagText}
            onChange={(e) => setHashtagText(e.target.value)}
            dir="ltr"
            placeholder="coffee smallbusiness telaviv"
            className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
          <p className="mt-1 text-xs text-ink-muted">
            מופרדים ברווח או פסיק. <Ltr>{hashtags.length}</Ltr> האשטגים
            {hashtags.length > 30 && (
              <span className="text-danger"> — חורג ממגבלת אינסטגרם (30)</span>
            )}
          </p>
        </div>

        <div className="mt-4">
          <label htmlFor="pillar" className="mb-1 block text-sm font-medium text-ink">
            קטגוריית תוכן
          </label>
          <input
            id="pillar"
            value={contentPillar}
            onChange={(e) => setContentPillar(e.target.value)}
            placeholder="למשל: מאחורי הקלעים, מוצר, טיפ"
            className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
          <p className="mt-1 text-xs text-ink-muted">
            נשמר לצד נתוני הביצועים. בשלב 3 המערכת תוכל להשוות אילו קטגוריות עובדות טוב יותר —
            אבל רק אם מסמנים אותן מהיום.
          </p>
        </div>
      </Card>

      <Card>
        <label className="mb-2 block text-sm font-medium text-ink">לאן לפרסם</label>
        <div className="space-y-2">
          {accounts.map((account) => (
            <div key={account.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-subtle p-3 text-sm hover:border-brand">
                <input
                  type="checkbox"
                  checked={selected.includes(account.id)}
                  onChange={() => toggleAccount(account.id)}
                  className="size-4"
                />
                <span className="font-medium text-ink">
                  {PLATFORM_LABELS[account.platform]}
                </span>
                <span className="text-ink-muted">{account.label}</span>
                {account.platform === Platform.TIKTOK && !account.isAudited && (
                  <span className="ms-auto rounded-md bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    Self-only
                  </span>
                )}
              </label>

              {selected.includes(account.id) && (
                <div className="mt-2 ps-6">
                  <label
                    htmlFor={`override-${account.id}`}
                    className="mb-1 block text-xs text-ink-muted"
                  >
                    כיתוב מותאם ל{PLATFORM_LABELS[account.platform]} (אופציונלי)
                  </label>
                  <textarea
                    id={`override-${account.id}`}
                    value={overrides[account.id] ?? ""}
                    onChange={(e) =>
                      setOverrides((o) => ({ ...o, [account.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder="ריק = הכיתוב הראשי"
                    className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {unauditedTikTok && (
          <div className="mt-4">
            <Alert tone="warning">
              הפוסט לטיקטוק יפורסם כ-<Ltr>Self-only</Ltr>. חשבון הטיקטוק חייב להיות מוגדר פרטי
              ברגע הפרסום, אחרת טיקטוק ידחה את הבקשה.
            </Alert>
          </div>
        )}
      </Card>

      <Card>
        <label htmlFor="scheduled" className="mb-1 block text-sm font-medium text-ink">
          מועד פרסום
        </label>
        <input
          id="scheduled"
          type="datetime-local"
          value={scheduledAtLocal}
          onChange={(e) => setScheduledAtLocal(e.target.value)}
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        <p className="mt-1 text-xs text-ink-muted">
          שעון ישראל. אם משאירים ריק — הפוסט יפורסם מיד עם האישור שלך.
        </p>
      </Card>

      {error && (
        <Alert tone="danger" title="לא ניתן לשמור">
          <p>{error}</p>
          {issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pe-5">
              {issues
                .filter((i) => i.severity === "error")
                .map((issue, index) => (
                  <li key={index}>
                    {PLATFORM_LABELS[issue.platform as Platform] ?? issue.platform}: {issue.message}
                  </li>
                ))}
            </ul>
          )}
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || selected.length === 0}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "שומר…" : "שמירה ושליחה לאישור"}
        </button>
        <p className="text-xs text-ink-muted">
          הפוסט לא יפורסם עד שתאשר אותו במסך האישורים.
        </p>
      </div>
    </form>
  );
}
