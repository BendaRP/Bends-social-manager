import { chromium, type Browser } from "playwright";
import { getEnv } from "@/lib/env";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  renderSlideHtml,
  type BrandStyle,
  type SlideContent,
  type TemplateName,
} from "./templates";

/**
 * Renders carousel slides to PNG.
 *
 * One browser instance is reused across slides — launching Chromium costs
 * roughly a second, and a six-slide carousel that pays it six times feels
 * broken. The instance is closed when the batch finishes rather than kept
 * warm: a long-lived browser in a worker process is a memory leak waiting to
 * be discovered in production.
 */

export interface RenderedSlide {
  index: number;
  png: Buffer;
  width: number;
  height: number;
}

export class RendererUnavailableError extends Error {
  constructor(cause: string) {
    super(
      "לא ניתן להפעיל את מנוע העיצוב (Chromium). " +
        "יש להריץ פעם אחת: npx playwright install chromium\n" +
        `הסיבה המקורית: ${cause}`,
    );
    this.name = "RendererUnavailableError";
  }
}

export async function renderCarousel(options: {
  slides: SlideContent[];
  brand: BrandStyle;
  template: TemplateName;
}): Promise<RenderedSlide[]> {
  const { slides, brand, template } = options;
  if (slides.length === 0) return [];

  let browser: Browser;
  try {
    browser = await chromium.launch({
      // Playwright resolves its own download by default. An explicit path lets a
      // deployment point at a Chromium the image already ships — a container
      // that installs one system-wide, or a sandbox whose bundled build does
      // not match the npm package's expected revision.
      executablePath: getEnv().CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--font-render-hinting=none"],
    });
  } catch (error) {
    throw new RendererUnavailableError((error as Error).message);
  }

  try {
    const page = await browser.newPage({
      viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      deviceScaleFactor: 1,
    });

    const rendered: RenderedSlide[] = [];

    for (const [index, slide] of slides.entries()) {
      const html = renderSlideHtml({
        slide,
        index,
        total: slides.length,
        brand,
        template,
      });

      await page.setContent(html, { waitUntil: "load" });
      // The font is embedded as a data URI, so this resolves immediately — but
      // screenshotting before it does would silently produce fallback glyphs,
      // and for Hebrew the fallback may be empty boxes.
      await page.evaluate(() => document.fonts.ready);

      rendered.push({
        index,
        png: await page.screenshot({ type: "png" }),
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
      });
    }

    return rendered;
  } finally {
    await browser.close();
  }
}
