import { hebrewFontFaceCss } from "./fonts";

/**
 * Carousel slide templates.
 *
 * These render real text through a real font, which is the whole reason the
 * carousel is built this way rather than by an image model: Hebrew text in
 * generated imagery comes out as letter-shaped noise, and a caption slide whose
 * text is unreadable is worthless however attractive the picture is.
 *
 * Canvas is 1080×1350 — the 4:5 portrait ratio, which occupies the most feed
 * height Instagram allows and so is the most seen.
 */

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;

export interface SlideContent {
  kicker?: string | null;
  headline: string;
  body?: string | null;
}

export interface BrandStyle {
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
  colorText: string;
  logoUrl?: string | null;
  businessName: string;
}

export type TemplateName = "bold" | "editorial" | "accent";

export const TEMPLATE_NAMES: TemplateName[] = ["bold", "editorial", "accent"];

export const TEMPLATE_LABELS: Record<TemplateName, string> = {
  bold: "נועז — כותרת גדולה על רקע מלא",
  editorial: "מגזין — אוורירי, עם קווים דקים",
  accent: "הדגשה — בלוק צבע מאחורי הכותרת",
};

interface RenderOptions {
  slide: SlideContent;
  index: number;
  total: number;
  brand: BrandStyle;
  template: TemplateName;
}

/**
 * Hebrew sets tighter than Latin — most letters have no ascenders or
 * descenders, so Latin line-height leaves the lines looking disconnected.
 */
const HEADLINE_LEADING = 1.12;
const BODY_LEADING = 1.5;

export function renderSlideHtml(options: RenderOptions): string {
  const { slide, index, total, brand, template } = options;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  // Long headlines get a smaller size rather than an overflowing box. The
  // generator is told to keep them short, but a template that breaks when it
  // does not is a template that will break.
  const headlineSize = fitHeadline(slide.headline, isFirst);

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<style>
${hebrewFontFaceCss()}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: ${SLIDE_WIDTH}px;
  height: ${SLIDE_HEIGHT}px;
  font-family: 'Assistant', sans-serif;
  overflow: hidden;
  position: relative;
  ${backgroundFor(template, brand, isFirst)}
}

.frame {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 110px 96px 130px;
}

.kicker {
  font-size: 34px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${kickerColor(template, brand, isFirst)};
  margin-bottom: 26px;
}

.headline {
  font-size: ${headlineSize}px;
  font-weight: 800;
  line-height: ${HEADLINE_LEADING};
  color: ${headlineColor(template, brand, isFirst)};
  /* Distributes words evenly across lines instead of filling each line and
     dropping the remainder alone on the last one. */
  text-wrap: balance;
}

/* The highlight has to sit on an inline span: .headline is a flex item, and a
   flex item is blockified, so an inline display on it is ignored and the
   highlight stretches the full content width instead of hugging the words. */
.headline .mark {
  ${template === "accent" && !isFirst ? accentBoxCss(brand) : ""}
}

.body {
  margin-top: 40px;
  font-size: 40px;
  font-weight: 400;
  line-height: ${BODY_LEADING};
  color: ${bodyColor(template, brand, isFirst)};
  /* A measure of roughly 38 Hebrew characters. The ch unit is sized from the digit
     glyph, which is far narrower than the average Hebrew letter, so it
     understates the real line length badly — set the measure in px instead. */
  max-width: 760px;
  text-wrap: pretty;
}

.rule {
  width: 128px;
  height: 6px;
  background: ${brand.colorAccent};
  border-radius: 3px;
  margin-top: 48px;
}

.footer {
  position: absolute;
  bottom: 76px;
  right: 96px;
  left: 96px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 28px;
  font-weight: 600;
  color: ${footerColor(template, brand, isFirst)};
}

.brand-name { opacity: 0.72; }

.pips { display: flex; gap: 10px; align-items: center; }
.pip {
  width: 10px; height: 10px; border-radius: 50%;
  background: ${footerColor(template, brand, isFirst)};
  opacity: 0.28;
}
.pip.on { opacity: 1; width: 30px; border-radius: 5px; }

/* A last slide reads as a destination when it is visually distinct. */
.cta-mark {
  position: absolute;
  bottom: 150px; right: 96px;
  font-size: 34px; font-weight: 800;
  color: ${brand.colorAccent};
}
</style>
</head>
<body>
  <div class="frame">
    ${slide.kicker ? `<div class="kicker">${escapeHtml(slide.kicker)}</div>` : ""}
    <h1 class="headline"><span class="mark">${escapeHtml(slide.headline)}</span></h1>
    ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
    ${isFirst ? '<div class="rule"></div>' : ""}
  </div>

  ${isLast && total > 1 ? '<div class="cta-mark">←</div>' : ""}

  <div class="footer">
    <span class="brand-name">${escapeHtml(brand.businessName)}</span>
    <span class="pips">
      ${Array.from({ length: total }, (_, i) => `<span class="pip${i === index ? " on" : ""}"></span>`).join("")}
    </span>
  </div>
</body>
</html>`;
}

/**
 * Headline size by length.
 *
 * Three steps rather than continuous scaling: a set of discrete sizes keeps the
 * slides in a series looking like a series, where per-slide fitted sizes make
 * each one subtly different and the set look careless.
 */
function fitHeadline(headline: string, isFirst: boolean): number {
  const base = isFirst ? 108 : 76;
  if (headline.length <= 24) return base;
  if (headline.length <= 42) return Math.round(base * 0.82);
  return Math.round(base * 0.66);
}

function backgroundFor(template: TemplateName, brand: BrandStyle, isFirst: boolean): string {
  if (template === "bold") {
    return isFirst
      ? `background: ${brand.colorPrimary};`
      : `background: ${brand.colorBackground};`;
  }
  if (template === "accent") {
    return `background: ${brand.colorBackground};`;
  }
  // editorial — a hairline frame gives the page an edge without a heavy border.
  return `background: ${brand.colorBackground};
  box-shadow: inset 0 0 0 2px ${hexWithAlpha(brand.colorPrimary, 0.12)};`;
}

function headlineColor(template: TemplateName, brand: BrandStyle, isFirst: boolean): string {
  if (template === "bold" && isFirst) return brand.colorBackground;
  return brand.colorText;
}

function kickerColor(template: TemplateName, brand: BrandStyle, isFirst: boolean): string {
  if (template === "bold" && isFirst) return brand.colorAccent;
  return brand.colorAccent;
}

function bodyColor(template: TemplateName, brand: BrandStyle, isFirst: boolean): string {
  if (template === "bold" && isFirst) return hexWithAlpha(brand.colorBackground, 0.86);
  return hexWithAlpha(brand.colorText, 0.78);
}

function footerColor(template: TemplateName, brand: BrandStyle, isFirst: boolean): string {
  if (template === "bold" && isFirst) return brand.colorBackground;
  return brand.colorText;
}

function accentBoxCss(brand: BrandStyle): string {
  const tint = hexWithAlpha(brand.colorAccent, 0.18);
  // box-decoration-break keeps the highlight intact across wrapped lines;
  // without it only the first line gets the side padding.
  return `display: inline;
  background: ${tint};
  box-shadow: 20px 0 0 ${tint}, -20px 0 0 ${tint};
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;`;
}

/** Accepts #RGB and #RRGGBB, since a colour picker may emit either. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
