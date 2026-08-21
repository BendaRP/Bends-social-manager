"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Platform, PostFormat } from "@prisma/client";
import { Card, Alert } from "@/components/ui";
import type { UploadedMedia } from "./media-uploader";

/**
 * AI drafting panel.
 *
 * Everything it produces lands in the composer's own fields, editable, and
 * still has to be saved and then approved. It drafts; it never publishes.
 */

const TEMPLATES = [
  { value: "bold", label: "נועז" },
  { value: "editorial", label: "מגזין" },
  { value: "accent", label: "הדגשה" },
] as const;

export interface AiResult {
  format: PostFormat;
  title: string;
  contentPillar: string;
  caption: string;
  hashtags: string[];
  perPlatform: Partial<Record<Platform, { caption: string; hashtags: string[] }>>;
  media: UploadedMedia[];
}

interface ManualSlide {
  kicker: string;
  headline: string;
  body: string;
}

const EMPTY_SLIDE: ManualSlide = { kicker: "", headline: "", body: "" };

export function AiPanel({
  selectedPlatforms,
  aiEnabled,
  onResult,
}: {
  selectedPlatforms: Platform[];
  /** False when no API key is configured — the manual designer still works. */
  aiEnabled: boolean;
  onResult: (result: AiResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<"post" | "carousel" | "manual">(
    aiEnabled ? "post" : "manual",
  );
  const [manualSlides, setManualSlides] = useState<ManualSlide[]>([
    { ...EMPTY_SLIDE },
    { ...EMPTY_SLIDE },
    { ...EMPTY_SLIDE },
  ]);
  const [slideCount, setSlideCount] = useState(6);
  const [template, setTemplate] = useState<string>("bold");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const platforms = selectedPlatforms.length > 0 ? selectedPlatforms : [Platform.INSTAGRAM];

  /**
   * Renders slides the user wrote. No API key, no token cost — the designer is
   * useful on its own to anyone willing to write their own copy.
   */
  async function renderManual() {
    const slides = manualSlides
      .filter((slide) => slide.headline.trim())
      .map((slide) => ({
        kicker: slide.kicker.trim() || null,
        headline: slide.headline.trim(),
        body: slide.body.trim() || null,
      }));

    if (slides.length === 0) {
      setError("צריך לפחות שקופית אחת עם כותרת");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("מעצב את השקופיות…");

    try {
      const response = await fetch("/api/carousel/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slides, template }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "העיצוב נכשל");

      onResult({
        format: PostFormat.CAROUSEL,
        title: slides[0]!.headline,
        contentPillar: "",
        caption: "",
        hashtags: [],
        perPlatform: {},
        media: body.media,
      });
      setStatus(null);
      setOpen(false);
    } catch (caught) {
      setError((caught as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (mode === "manual") return renderManual();

    if (!brief.trim()) {
      setError("צריך לכתוב על מה הפוסט");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(mode === "carousel" ? "כותב ומעצב את השקופיות…" : "כותב את הפוסט…");

    try {
      const endpoint = mode === "carousel" ? "/api/ai/carousel" : "/api/ai/post";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "carousel"
            ? { brief, platforms, slideCount, template }
            : { brief, platforms },
        ),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "היצירה נכשלה");

      onResult(mode === "carousel" ? toCarouselResult(body) : toPostResult(body));
      setStatus(null);
      setOpen(false);
    } catch (caught) {
      setError((caught as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand/50 bg-brand-soft px-4 py-4 text-sm font-medium text-brand hover:bg-brand/10"
      >
        <Sparkles className="size-4" aria-hidden />
        {aiEnabled ? "לכתוב את הפוסט עם AI" : "לעצב קרוסלה"}
      </button>
    );
  }

  return (
    <Card className="border-brand/40">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="size-4 text-brand" aria-hidden />
        <h2 className="text-base font-semibold text-ink">יצירת תוכן</h2>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["post", "פוסט", true],
            ["carousel", "קרוסלה", true],
            ["manual", "קרוסלה — טקסט שלי (חינם)", false],
          ] as const
        )
          .filter(([, , needsAi]) => aiEnabled || !needsAi)
          .map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={
              mode === value
                ? "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-ink-muted hover:border-brand hover:text-brand"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "manual" && (
        <div className="mb-4">
          <Alert tone="info">
            כאן אתה כותב את הטקסט והמערכת מעצבת אותו לשקופיות. לא נדרש מפתח API
            ואין שום עלות.
          </Alert>
        </div>
      )}

      {mode !== "manual" && (
      <>
      <label htmlFor="brief" className="mb-1 block text-sm font-medium text-ink">
        על מה הפוסט?
      </label>
      <p className="mb-2 text-xs text-ink-muted">
        מספיק משפט. ככל שתוסיף פרטים אמיתיים — מספר, סיפור, משהו שקרה — כך התוצאה
        תהיה פחות גנרית.
      </p>
      <textarea
        id="brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        placeholder="למשל: טיפים לזוגות שגרים יחד בפעם הראשונה"
        className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
      />
      </>
      )}

      {mode === "manual" && (
        <div className="space-y-4">
          {manualSlides.map((slide, index) => (
            <div key={index} className="rounded-lg border border-border-subtle p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">שקופית {index + 1}</span>
                {manualSlides.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setManualSlides((slides) => slides.filter((_, i) => i !== index))
                    }
                    className="text-xs text-ink-muted hover:text-danger"
                  >
                    הסרה
                  </button>
                )}
              </div>

              <input
                value={slide.kicker}
                onChange={(e) =>
                  setManualSlides((slides) =>
                    slides.map((s, i) => (i === index ? { ...s, kicker: e.target.value } : s)),
                  )
                }
                placeholder="מילה קטנה מעל הכותרת (אופציונלי)"
                maxLength={20}
                className="mb-2 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
              <input
                value={slide.headline}
                onChange={(e) =>
                  setManualSlides((slides) =>
                    slides.map((s, i) => (i === index ? { ...s, headline: e.target.value } : s)),
                  )
                }
                placeholder="הכותרת — קצרה ככל האפשר"
                maxLength={80}
                className="mb-2 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand"
              />
              <textarea
                value={slide.body}
                onChange={(e) =>
                  setManualSlides((slides) =>
                    slides.map((s, i) => (i === index ? { ...s, body: e.target.value } : s)),
                  )
                }
                placeholder="משפט הסבר (אופציונלי)"
                maxLength={200}
                rows={2}
                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </div>
          ))}

          {manualSlides.length < 10 && (
            <button
              type="button"
              onClick={() => setManualSlides((slides) => [...slides, { ...EMPTY_SLIDE }])}
              className="w-full rounded-lg border border-dashed border-border-subtle px-4 py-2 text-sm text-ink-muted hover:border-brand hover:text-brand"
            >
              + שקופית
            </button>
          )}
        </div>
      )}

      {(mode === "carousel" || mode === "manual") && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {mode === "carousel" && (
            <div>
              <label htmlFor="slides" className="mb-1 block text-sm font-medium text-ink">
                מספר שקופיות
              </label>
              <input
                id="slides"
                type="number"
                min={3}
                max={10}
                value={slideCount}
                onChange={(e) => setSlideCount(Number(e.target.value))}
                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">סגנון עיצוב</label>
            <div className="flex gap-1">
              {TEMPLATES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTemplate(option.value)}
                  className={
                    template === option.value
                      ? "rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white"
                      : "rounded-lg border border-border-subtle px-3 py-2 text-xs text-ink-muted hover:border-brand"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? (status ?? "עובד…") : mode === "manual" ? "עצב את השקופיות" : "צור"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-sm text-ink-muted hover:text-ink disabled:opacity-50"
        >
          ביטול
        </button>
        {mode !== "post" && (
          <span className="text-xs text-ink-muted">עיצוב השקופיות לוקח כחצי דקה</span>
        )}
      </div>
    </Card>
  );
}

interface PostResponse {
  title: string;
  contentPillar: string;
  captions: Array<{ platform: Platform; caption: string; hashtags: string[] }>;
}

function toPostResult(body: PostResponse): AiResult {
  const perPlatform: AiResult["perPlatform"] = {};
  for (const entry of body.captions) {
    perPlatform[entry.platform] = { caption: entry.caption, hashtags: entry.hashtags };
  }

  // The first platform's copy seeds the shared fields; the rest become
  // per-platform overrides, which is exactly the shape the composer already has.
  const primary = body.captions[0];

  return {
    format: PostFormat.SINGLE_IMAGE,
    title: body.title,
    contentPillar: body.contentPillar,
    caption: primary?.caption ?? "",
    hashtags: primary?.hashtags ?? [],
    perPlatform,
    media: [],
  };
}

interface CarouselResponse {
  carousel: { title: string; contentPillar: string; caption: string; hashtags: string[] };
  media: UploadedMedia[];
}

function toCarouselResult(body: CarouselResponse): AiResult {
  return {
    format: PostFormat.CAROUSEL,
    title: body.carousel.title,
    contentPillar: body.carousel.contentPillar,
    caption: body.carousel.caption,
    hashtags: body.carousel.hashtags,
    perPlatform: {},
    media: body.media,
  };
}
