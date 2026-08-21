import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { requireBrandProfile } from "@/ai/brand";
import { generatePostDraft } from "@/ai/generate";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  brief: z.string().min(1).max(4000),
  platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"])).min(1),
});

/**
 * Writes a post draft. Produces text only — the result still has to be saved
 * and then approved before anything reaches a real account.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = schema.parse(await request.json());
    const brand = await requireBrandProfile();
    return NextResponse.json(
      await generatePostDraft({ brand, brief: body.brief, platforms: body.platforms }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
