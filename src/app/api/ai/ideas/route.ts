import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { requireBrandProfile } from "@/ai/brand";
import { generateIdeas } from "@/ai/generate";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  brief: z.string().max(2000).default(""),
  count: z.number().int().min(1).max(10).default(5),
});

export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = schema.parse(await request.json());
    const brand = await requireBrandProfile();
    return NextResponse.json(await generateIdeas(brand, body.brief, body.count));
  } catch (error) {
    return handleApiError(error);
  }
}
