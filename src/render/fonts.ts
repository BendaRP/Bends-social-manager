import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Hebrew typeface, embedded rather than linked.
 *
 * A carousel must render identically every time it runs. A webfont fetched at
 * render time can be slow, blocked, or simply not finished when the screenshot
 * is taken — and the failure is silent: the page falls back to a system font
 * that may not cover Hebrew at all, producing tofu boxes in an image that is
 * then published. Embedding the bytes removes the network from the path.
 */

const FONT_DIR = join(process.cwd(), "src", "render", "fonts");

const WEIGHTS = [400, 600, 800] as const;

let cached: string | null = null;

export function hebrewFontFaceCss(): string {
  if (cached) return cached;

  cached = WEIGHTS.map((weight) => {
    const data = readFileSync(join(FONT_DIR, `Assistant-${weight}.ttf`)).toString("base64");
    return `@font-face {
  font-family: 'Assistant';
  font-style: normal;
  font-weight: ${weight};
  src: url(data:font/ttf;base64,${data}) format('truetype');
}`;
  }).join("\n");

  return cached;
}
