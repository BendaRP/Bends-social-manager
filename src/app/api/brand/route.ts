import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, audit } from "@/server/auth";
import { prisma } from "@/server/db";
import { BRAND_ID } from "@/ai/brand";
import { handleApiError } from "@/lib/api";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const schema = z.object({
  businessName: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  audience: z.string().min(1).max(2000),
  toneWords: z.array(z.string().max(40)).max(12).default([]),
  voiceNotes: z.string().max(4000).optional().nullable(),
  preferWords: z.array(z.string().max(60)).max(60).default([]),
  avoidWords: z.array(z.string().max(60)).max(60).default([]),
  contentPillars: z.array(z.string().max(60)).max(20).default([]),
  language: z.string().min(2).max(10).default("he"),
  colorPrimary: z.string().regex(HEX),
  colorAccent: z.string().regex(HEX),
  colorBackground: z.string().regex(HEX),
  colorText: z.string().regex(HEX),
  logoUrl: z.string().url().optional().nullable(),
  useEmoji: z.boolean().default(true),
});

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await request.json());

    const data = {
      ...body,
      voiceNotes: body.voiceNotes ?? null,
      logoUrl: body.logoUrl ?? null,
    };

    const brand = await prisma.brandProfile.upsert({
      where: { id: BRAND_ID },
      create: { id: BRAND_ID, ...data },
      update: data,
    });

    await audit(user.id, "brand.updated", "BrandProfile", brand.id);
    return NextResponse.json({ brand });
  } catch (error) {
    return handleApiError(error);
  }
}
