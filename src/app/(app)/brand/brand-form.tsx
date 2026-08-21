"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BrandProfile } from "@prisma/client";
import { Card, Alert } from "@/components/ui";

const INPUT =
  "w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      {hint && <p className="mb-2 text-xs text-ink-muted">{hint}</p>}
      {children}
    </div>
  );
}

const toList = (value: string) =>
  value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);

export function BrandForm({ brand }: { brand: BrandProfile | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const form = new FormData(event.currentTarget);
    const payload = {
      businessName: String(form.get("businessName") ?? ""),
      description: String(form.get("description") ?? ""),
      audience: String(form.get("audience") ?? ""),
      toneWords: toList(String(form.get("toneWords") ?? "")),
      voiceNotes: String(form.get("voiceNotes") ?? "") || null,
      preferWords: toList(String(form.get("preferWords") ?? "")),
      avoidWords: toList(String(form.get("avoidWords") ?? "")),
      contentPillars: toList(String(form.get("contentPillars") ?? "")),
      language: "he",
      colorPrimary: String(form.get("colorPrimary") ?? "#2D2A32"),
      colorAccent: String(form.get("colorAccent") ?? "#E4572E"),
      colorBackground: String(form.get("colorBackground") ?? "#FAF7F2"),
      colorText: String(form.get("colorText") ?? "#2D2A32"),
      useEmoji: form.get("useEmoji") === "on",
    };

    const response = await fetch("/api/brand", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "השמירה נכשלה");
      setBusy(false);
      return;
    }

    setSaved(true);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <Card className="mb-5">
        <Field label="שם העסק">
          <input name="businessName" required defaultValue={brand?.businessName ?? ""} className={INPUT} />
        </Field>

        <Field
          label="מה העסק עושה"
          hint="במילים שלך, לא בשפת שיווק. מה אתם מוכרים, למי, ומה מייחד אתכם."
        >
          <textarea name="description" required rows={4} defaultValue={brand?.description ?? ""} className={INPUT} />
        </Field>

        <Field label="קהל היעד" hint="מי הם, מה מעניין אותם, מה הם מחפשים אצלכם.">
          <textarea name="audience" required rows={3} defaultValue={brand?.audience ?? ""} className={INPUT} />
        </Field>
      </Card>

      <Card className="mb-5">
        <h2 className="mb-4 text-base font-semibold text-ink">הקול</h2>

        <Field label="מילות טון" hint="מופרדות בפסיק. למשל: חם, ישיר, עם הומור">
          <input name="toneWords" defaultValue={brand?.toneWords.join(", ") ?? ""} className={INPUT} />
        </Field>

        <Field
          label="הנחיות נוספות"
          hint="כל דבר שחשוב שיידע — איך פונים לקהל, מה אף פעם לא אומרים, דוגמאות למשפטים שאתם אוהבים."
        >
          <textarea name="voiceNotes" rows={3} defaultValue={brand?.voiceNotes ?? ""} className={INPUT} />
        </Field>

        <Field label="מילים להעדיף">
          <input name="preferWords" defaultValue={brand?.preferWords.join(", ") ?? ""} className={INPUT} />
        </Field>

        <Field
          label="מילים לאסור"
          hint="זה השדה שהכי משפר את התוצאה. כאן רושמים את הקלישאות של התחום שלכם, שאחרת המודל יגיע אליהן מעצמו."
        >
          <input name="avoidWords" defaultValue={brand?.avoidWords.join(", ") ?? ""} className={INPUT} />
        </Field>

        <Field
          label="קטגוריות תוכן"
          hint="הנושאים החוזרים שלכם. נשמרים לצד הביצועים, כדי שבהמשך אפשר יהיה להשוות איזו קטגוריה עובדת."
        >
          <input name="contentPillars" defaultValue={brand?.contentPillars.join(", ") ?? ""} className={INPUT} />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="useEmoji" defaultChecked={brand?.useEmoji ?? true} className="size-4" />
          מותר להשתמש באימוג&apos;ים
        </label>
      </Card>

      <Card className="mb-5">
        <h2 className="mb-1 text-base font-semibold text-ink">צבעי המותג</h2>
        <p className="mb-4 text-xs text-ink-muted">
          משמשים בעיצוב שקופיות הקרוסלה.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["colorPrimary", "ראשי", brand?.colorPrimary ?? "#2D2A32"],
              ["colorAccent", "הדגשה", brand?.colorAccent ?? "#E4572E"],
              ["colorBackground", "רקע", brand?.colorBackground ?? "#FAF7F2"],
              ["colorText", "טקסט", brand?.colorText ?? "#2D2A32"],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name}>
              <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
              <div className="flex items-center gap-2">
                <input type="color" name={name} defaultValue={value} className="size-10 rounded border border-border-subtle" />
                <span className="text-xs text-ink-muted" dir="ltr">{value}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert tone="success">זהות המותג נשמרה.</Alert>}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "שומר…" : "שמירה"}
      </button>
    </form>
  );
}
