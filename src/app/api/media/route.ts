import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { publicUrlFor, verifyPubliclyReachable } from "@/server/storage";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  storageKey: z.string().min(1),
  type: z.enum(["IMAGE", "VIDEO"]),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  originalFilename: z.string().optional(),
});

/**
 * Registers a finished upload.
 *
 * The public reachability check runs here, at upload time, because this is the
 * last moment the user is present to fix it. Discovering that the bucket is
 * private when a scheduled post fires means a missed post.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = schema.parse(await request.json());
    const publicUrl = publicUrlFor(body.storageKey);

    const reachability = await verifyPubliclyReachable(publicUrl);
    if (!reachability.reachable) {
      return NextResponse.json(
        {
          error:
            `הקובץ הועלה אבל אינו נגיש לציבור בכתובת ${publicUrl}. ` +
            `אינסטגרם וטיקטוק מושכים את המדיה בעצמם ללא הרשאות, ולכן הדלי חייב להיות ציבורי לקריאה. ` +
            (reachability.reason ?? ""),
        },
        { status: 400 },
      );
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        type: body.type,
        storageKey: body.storageKey,
        publicUrl,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        width: body.width ?? null,
        height: body.height ?? null,
        durationSec: body.durationSec ?? null,
        aspectRatio:
          body.width && body.height ? body.width / body.height : null,
        originalFilename: body.originalFilename ?? null,
      },
    });

    return NextResponse.json(asset);
  } catch (error) {
    return handleApiError(error);
  }
}
