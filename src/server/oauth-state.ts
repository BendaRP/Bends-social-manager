import { randomBytes } from "node:crypto";
import { getRedis } from "./redis";

/**
 * OAuth state and PKCE verifier storage.
 *
 * The `state` parameter is what stops a third party from tricking the owner's
 * browser into completing an OAuth flow the owner never started, which would
 * attach an attacker's social account to this installation. It is generated
 * here, stored server-side, and must match on the way back.
 *
 * Redis rather than a cookie because the PKCE verifier lives alongside it and
 * should never travel to the browser at all.
 */

const TTL_SECONDS = 600;

export interface OAuthStatePayload {
  platform: string;
  codeVerifier?: string;
  userId: string;
}

export async function createState(payload: OAuthStatePayload): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await getRedis().set(
    `oauth:state:${state}`,
    JSON.stringify(payload),
    "EX",
    TTL_SECONDS,
  );
  return state;
}

/** Reads and immediately deletes the state, so a code cannot be replayed. */
export async function consumeState(state: string): Promise<OAuthStatePayload | null> {
  const redis = getRedis();
  const key = `oauth:state:${state}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key);
  return JSON.parse(raw) as OAuthStatePayload;
}
