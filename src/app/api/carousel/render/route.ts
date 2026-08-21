import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { requireBrandProfile } from "@/ai/brand";
import { renderCarouselToMedia } from "@/ai/carousel-media";
import { TEMPLATE_NAMES, type TemplateName } from "@/render/templates";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  slides: z
    .array(
      z.object({
        kicker: z.string().max(20).optional().nullable(),
        headline: z.string().min(1).max(80),
        body: z.string().max(200).optional().nullable(),
      }),
    )
    .min(1)
    .max(10),
  template: z.enum(TEMPLATE_NAMES as [TemplateName, ...TemplateName[]]).default("bold"),
});

/**
 * Renders carousel slides from copy the user wrote.
 *
 * Deliberately independent of the AI routes: rendering is where most of the
 * value is for someone who can write their own copy, and it costs nothing to
 * run. Requiring an API key to reach the designer would have withheld a free
 * feature behind a paid one.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = schema.parse(await request.json());
    const brand = await requireBrandProfile();

    const media = await renderCarouselToMedia({
      slides: body.slides,
      brand,
      template: body.template,
    });

    return NextResponse.json({ media });
  } catch (error) {
    return handleApiError(error);
  }
}
