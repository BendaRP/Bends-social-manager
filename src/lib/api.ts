import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/server/auth";

/**
 * Uniform error handling for route handlers.
 *
 * Internal error text can carry table names, file paths and occasionally
 * fragments of a platform response, so only deliberate messages are sent to the
 * client; everything else is logged and reported generically.
 */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "Invalid request", details: error.message }, { status: 400 });
  }

  console.error("[api]", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unexpected error" },
    { status: 500 },
  );
}
