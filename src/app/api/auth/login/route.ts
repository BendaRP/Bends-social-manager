import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSession, verifyPassword, audit } from "@/server/auth";
import { handleApiError } from "@/lib/api";
import { getRedis } from "@/server/redis";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Login, rate limited per address.
 *
 * These credentials guard accounts that can post publicly on the owner's
 * behalf, so an unthrottled login form is not acceptable even for a
 * single-user app.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 900;

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());

    const redis = getRedis();
    const key = `login:attempts:${body.email.toLowerCase()}`;
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, WINDOW_SECONDS);

    if (attempts > MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "יותר מדי ניסיונות התחברות. נסה שוב בעוד רבע שעה." },
        { status: 429 },
      );
    }

    const user = await verifyPassword(body.email, body.password);
    if (!user) {
      return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 });
    }

    await redis.del(key);
    await createSession(user.id);
    await audit(user.id, "auth.login", "User", user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
