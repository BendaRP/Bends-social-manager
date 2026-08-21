import { describe, expect, it } from "vitest";
import { renderCarousel, RendererUnavailableError } from "@/render/carousel";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/render/templates";

/**
 * Renders through real Chromium. Skipped where no browser is installed, since
 * a missing browser is an environment gap rather than a code defect.
 */
const brand = {
  businessName: "Couples Corner",
  colorPrimary: "#2D2A32",
  colorAccent: "#E4572E",
  colorBackground: "#FAF7F2",
  colorText: "#2D2A32",
};

async function canRender(): Promise<boolean> {
  try {
    await renderCarousel({ slides: [{ headline: "בדיקה" }], brand, template: "bold" });
    return true;
  } catch (error) {
    if (error instanceof RendererUnavailableError) return false;
    throw error;
  }
}

const available = await canRender();

describe.skipIf(!available)("carousel rendering", () => {
  it("produces one PNG per slide at Instagram portrait size", async () => {
    const slides = [
      { headline: "5 דברים שכל זוג צריך לדעת" },
      { kicker: "ראשון", headline: "לדבר לפני שכועסים", body: "שיחה קצרה בזמן חוסכת ערב שלם." },
      { kicker: "לסיכום", headline: "מה תיישמו השבוע?" },
    ];

    const rendered = await renderCarousel({ slides, brand, template: "accent" });

    expect(rendered).toHaveLength(3);
    for (const [index, slide] of rendered.entries()) {
      expect(slide.index).toBe(index);
      expect(slide.width).toBe(SLIDE_WIDTH);
      expect(slide.height).toBe(SLIDE_HEIGHT);
      // PNG magic number — proves real image bytes, not an error page.
      expect(slide.png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  }, 120_000);

  it("renders Hebrew rather than falling back to blank glyphs", async () => {
    // The failure this guards against is silent: a missing Hebrew font renders
    // tofu boxes, the screenshot still succeeds, and an unreadable image gets
    // published. Identical byte output for different Hebrew strings is the
    // signature of that failure.
    const [alef] = await renderCarousel({
      slides: [{ headline: "אאאאא" }],
      brand,
      template: "bold",
    });
    const [tav] = await renderCarousel({
      slides: [{ headline: "תתתתת" }],
      brand,
      template: "bold",
    });

    expect(alef!.png.equals(tav!.png)).toBe(false);
  }, 120_000);

  it("varies the output by template", async () => {
    const slides = [{ kicker: "כותרת", headline: "אותו טקסט", body: "אותו גוף." }];
    const bold = await renderCarousel({ slides, brand, template: "bold" });
    const editorial = await renderCarousel({ slides, brand, template: "editorial" });
    expect(bold[0]!.png.equals(editorial[0]!.png)).toBe(false);
  }, 120_000);

  it("returns nothing for an empty slide list without launching a browser", async () => {
    expect(await renderCarousel({ slides: [], brand, template: "bold" })).toEqual([]);
  });
});
