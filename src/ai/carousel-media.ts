import type { BrandProfile } from "@prisma/client";
import { prisma } from "@/server/db";
import { uploadObject } from "@/server/storage";
import { renderCarousel } from "@/render/carousel";
import type { SlideContent, TemplateName } from "@/render/templates";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/render/templates";

/**
 * Renders carousel slides and registers them as media, ready to attach to a
 * post.
 *
 * Slides are uploaded sequentially rather than in parallel: a ten-slide
 * carousel is ~10MB, and firing every upload at once on a home connection
 * makes them all slow instead of finishing the first ones early.
 */
export async function renderCarouselToMedia(options: {
  slides: SlideContent[];
  brand: BrandProfile;
  template: TemplateName;
}): Promise<Array<{ id: string; publicUrl: string; type: "IMAGE" }>> {
  const rendered = await renderCarousel({
    slides: options.slides,
    template: options.template,
    brand: {
      businessName: options.brand.businessName,
      colorPrimary: options.brand.colorPrimary,
      colorAccent: options.brand.colorAccent,
      colorBackground: options.brand.colorBackground,
      colorText: options.brand.colorText,
      logoUrl: options.brand.logoUrl,
    },
  });

  const media: Array<{ id: string; publicUrl: string; type: "IMAGE" }> = [];

  for (const slide of rendered) {
    const { storageKey, publicUrl } = await uploadObject({
      bytes: slide.png,
      contentType: "image/png",
      extension: "png",
    });

    const asset = await prisma.mediaAsset.create({
      data: {
        type: "IMAGE",
        storageKey,
        publicUrl,
        mimeType: "image/png",
        sizeBytes: slide.png.length,
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        aspectRatio: SLIDE_WIDTH / SLIDE_HEIGHT,
        originalFilename: `slide-${slide.index + 1}.png`,
      },
    });

    media.push({ id: asset.id, publicUrl: asset.publicUrl, type: "IMAGE" });
  }

  return media;
}
