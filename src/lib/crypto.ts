import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { getEnv } from "./env";

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Threat model: an attacker who obtains a database dump (a leaked backup, a
 * compromised managed-Postgres snapshot) must not gain the ability to post to
 * the connected social accounts. The master key lives in the host's secret
 * manager and is never written to the database, so ciphertext alone is inert.
 *
 * Format: v<keyId>.<iv-b64>.<authTag-b64>.<ciphertext-b64>
 *
 * The key id is embedded in the payload so the master key can be rotated
 * without a migration: new writes use the current key, old rows stay readable
 * until re-encrypted.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the GCM-recommended nonce size.
const KEY_LENGTH = 32; // 256 bits.

function loadKey(keyId: string): Buffer {
  const env = getEnv();

  // Only one key is configured today. Rotation adds ENCRYPTION_MASTER_KEY_<id>
  // entries and this lookup starts consulting them.
  const raw =
    keyId === env.ENCRYPTION_KEY_ID
      ? env.ENCRYPTION_MASTER_KEY
      : process.env[`ENCRYPTION_MASTER_KEY_${keyId.toUpperCase()}`];

  if (!raw) {
    throw new Error(
      `No encryption key available for key id "${keyId}". Tokens encrypted ` +
        `with it cannot be read until the key is restored.`,
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Encryption key "${keyId}" must be ${KEY_LENGTH} bytes base64-encoded, ` +
        `got ${key.length}. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

export interface EncryptedValue {
  cipher: string;
  keyId: string;
}

export function encrypt(plaintext: string): EncryptedValue {
  const keyId = getEnv().ENCRYPTION_KEY_ID;
  const key = loadKey(keyId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    cipher: [
      `v${keyId}`,
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join("."),
    keyId,
  };
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4) {
    throw new Error("Malformed ciphertext: expected 4 dot-separated segments");
  }
  const [versionTag, ivB64, authTagB64, dataB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (!versionTag.startsWith("v")) {
    throw new Error("Malformed ciphertext: missing key version prefix");
  }

  const key = loadKey(versionTag.slice(1));
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  // GCM authentication means a tampered ciphertext throws here rather than
  // returning garbage that we might send to a platform API.
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Hashes session tokens so the database never holds a usable session value. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for secrets such as OAuth state parameters. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Redacts credential-shaped values before anything reaches a log or the
 * PublishAttempt.debugPayload column. Errors from Meta and TikTok routinely
 * echo the access token back in the request URL.
 */
export function redactSecrets<T>(value: T): T {
  const SENSITIVE = /(access_token|refresh_token|client_secret|code|token|secret|password|authorization)/i;

  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      return input.replace(
        /((?:access_token|client_secret|refresh_token|code)=)[^&\s]+/gi,
        "$1[REDACTED]",
      );
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([k, v]) =>
          SENSITIVE.test(k) ? [k, "[REDACTED]"] : [k, walk(v)],
        ),
      );
    }
    return input;
  };

  return walk(value) as T;
}
