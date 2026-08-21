import { describe, expect, it } from "vitest";
import { escapeHtml, hexWithAlpha, renderSlideHtml } from "@/render/templates";

const brand = {
  businessName: "Couples Corner",
  colorPrimary: "#2D2A32",
  colorAccent: "#E4572E",
  colorBackground: "#FAF7F2",
  colorText: "#2D2A32",
};

describe("hexWithAlpha", () => {
  it("expands shorthand hex", () => {
    expect(hexWithAlpha("#F00", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("handles full hex", () => {
    expect(hexWithAlpha("#2D2A32", 0.18)).toBe("rgba(45, 42, 50, 0.18)");
  });

  it("returns the input unchanged when it cannot parse it", () => {
    // A malformed colour must not become "rgba(NaN, NaN, NaN, …)", which
    // renders as transparent and silently loses the design.
    expect(hexWithAlpha("not-a-colour", 0.5)).toBe("not-a-colour");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup in generated copy", () => {
    // Slide text comes from a model and goes straight into HTML; an unescaped
    // angle bracket would break the layout at best.
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("leaves Hebrew untouched", () => {
    expect(escapeHtml("שלום עולם")).toBe("שלום עולם");
  });
});

describe("slide markup", () => {
  const base = { slide: { headline: "כותרת" }, total: 4, brand, template: "bold" as const };

  it("declares Hebrew and right-to-left on the document", () => {
    const html = renderSlideHtml({ ...base, index: 0 });
    expect(html).toContain('lang="he"');
    expect(html).toContain('dir="rtl"');
  });

  it("embeds the font rather than linking it", () => {
    // A linked webfont can fail to load before the screenshot, and the Hebrew
    // fallback may be empty boxes — in an image that then gets published.
    const html = renderSlideHtml({ ...base, index: 0 });
    expect(html).toContain("data:font/ttf;base64,");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("marks the current slide in the indicator", () => {
    const html = renderSlideHtml({ ...base, index: 2 });
    // Anchored so the `pips` container span does not count as a pip.
    const pips = html.match(/<span class="pip(?: on)?"/g) ?? [];
    expect(pips).toHaveLength(4);
    expect(pips.filter((p) => p.includes("pip on"))).toHaveLength(1);
    expect(pips[2]).toContain("pip on");
  });

  it("omits the body element entirely when there is no body text", () => {
    const html = renderSlideHtml({ ...base, index: 0 });
    expect(html).not.toContain('class="body"');
  });

  it("scales the headline down as it gets longer", () => {
    const short = renderSlideHtml({ ...base, index: 1, slide: { headline: "קצר" } });
    const long = renderSlideHtml({
      ...base,
      index: 1,
      slide: { headline: "כותרת ארוכה מאוד שלא הייתה אמורה להגיע לכאן אבל הגיעה" },
    });
    const sizeOf = (html: string) => Number(/font-size: (\d+)px;\n  font-weight: 800/.exec(html)?.[1]);
    expect(sizeOf(long)).toBeLessThan(sizeOf(short));
  });

  it("puts the highlight on an inline span, not the flex item", () => {
    // .headline is a flex child and therefore blockified — an inline display on
    // it is ignored and the highlight stretches the full width.
    const html = renderSlideHtml({ ...base, index: 1, template: "accent" });
    expect(html).toContain('<span class="mark">');
    expect(html).toContain(".headline .mark");
  });
});
