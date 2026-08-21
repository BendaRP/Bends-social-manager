import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createPresignedUpload } from "@/server/storage";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

// Refuse oversized uploads before issuing a URL, rather than after the user has
// spent ten minutes uploading a file no platform would accept.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = schema.parse(await request.json());

    if (!ALLOWED_MIME.has(body.mimeType)) {
      return NextResponse.json(
        { error: `סוג הקובץ ${body.mimeType} לא נתמך` },
        { status: 400 },
      );
    }
    if (body.sizeBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "הקובץ גדול מדי" }, { status: 400 });
    }

    return NextResponse.json(await createPresignedUpload(body.filename, body.mimeType));
  } catch (error) {
    return handleApiError(error);
  }
}
