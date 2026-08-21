import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { approvePost } from "@/server/posts";
import { handleApiError } from "@/lib/api";

/**
 * The approval endpoint — the one deliberate human action that lets a post
 * reach a live account.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const post = await approvePost(id, user.id);
    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error);
  }
}
