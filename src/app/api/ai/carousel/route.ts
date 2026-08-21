import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { requireBrandProfile } from "@/ai/brand";
import { generateCarousel } from "@/ai/generate";
import { renderCarouselToMedia } from "@/ai/carousel-media";
import { TEMPLATE_NAMES, type TemplateName } from "@/render/templates";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  brief: z.string().min(1).max(4000),
  slideCount: z.number().int().min(3).max(10).default(6),
  template: z.enum(TEMPLATE_NAMES as [TemplateName, ...TemplateName[]]).default("bold"),
  platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"])).min(1),
});

/**
 * Writes and renders a carousel: Claude produces the slide copy, the template
 * renders it to real images, and those are registered as media ready to attach.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = schema.parse(await request.json());
    const brand = await requireBrandProfile();

    const carousel = await generateCarousel({
      brand,
      brief: body.brief,
      platforms: body.platforms,
      slideCount: body.slideCount,
    });

    const media = await renderCarouselToMedia({
      slides: carousel.slides,
      brand,
      template: body.template,
    });

    return NextResponse.json({ carousel, media });
  } catch (error) {
    return handleApiError(error);
  }
}
