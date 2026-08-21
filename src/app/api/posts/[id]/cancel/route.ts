import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { cancelPost } from "@/server/posts";
import { handleApiError } from "@/lib/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return NextResponse.json({ post: await cancelPost(id, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}
