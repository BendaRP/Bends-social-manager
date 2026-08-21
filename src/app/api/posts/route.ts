import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostFormat, Visibility } from "@prisma/client";
import { requireUser, audit } from "@/server/auth";
import { createPost, validatePostForTargets } from "@/server/posts";
import { hasBlockingIssues } from "@/server/validation";
import { parseLocalInput } from "@/lib/time";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  title: z.string().max(200).optional(),
  format: z.nativeEnum(PostFormat),
  caption: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  contentPillar: z.string().max(100).optional(),
  mediaIds: z.array(z.string()).default([]),
  /** Local wall-clock time in the audience timezone, e.g. "2026-08-25T19:30". */
  scheduledAtLocal: z.string().nullable().optional(),
  targets: z
    .array(
      z.object({
        accountId: z.string(),
        captionOverride: z.string().optional(),
        hashtagsOverride: z.array(z.string()).optional(),
        scheduledAtLocal: z.string().nullable().optional(),
        requestedVisibility: z.nativeEnum(Visibility).optional(),
      }),
    )
    .min(1),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await request.json());

    // Reject anything the platforms would reject, before it enters the calendar
    // as a post that looks scheduled but can never go out.
    const issues = await validatePostForTargets({
      format: body.format,
      caption: body.caption,
      hashtags: body.hashtags,
      mediaIds: body.mediaIds,
      accountIds: body.targets.map((t) => t.accountId),
    });

    if (hasBlockingIssues(issues)) {
      return NextResponse.json(
        { error: "הפוסט לא עומד בדרישות של אחת הפלטפורמות", issues },
        { status: 400 },
      );
    }

    const post = await createPost({
      userId: user.id,
      title: body.title,
      format: body.format,
      caption: body.caption,
      hashtags: body.hashtags,
      contentPillar: body.contentPillar,
      mediaIds: body.mediaIds,
      scheduledAt: body.scheduledAtLocal ? parseLocalInput(body.scheduledAtLocal) : null,
      targets: body.targets.map((target) => ({
        accountId: target.accountId,
        captionOverride: target.captionOverride,
        hashtagsOverride: target.hashtagsOverride,
        scheduledAt: target.scheduledAtLocal
          ? parseLocalInput(target.scheduledAtLocal)
          : undefined,
        requestedVisibility: target.requestedVisibility,
      })),
    });

    await audit(user.id, "post.created", "Post", post.id, { format: body.format });

    return NextResponse.json({ post, warnings: issues.filter((i) => i.severity === "warning") });
  } catch (error) {
    return handleApiError(error);
  }
}
