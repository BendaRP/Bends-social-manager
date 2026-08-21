import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/lib/env";

/**
 * S3-compatible media storage (Cloudflare R2 by default).
 *
 * Two properties matter here and drive the design:
 *
 *  1. Uploads go browser -> bucket directly via a presigned URL. Routing a
 *     500MB video through the Next.js server would blow past request body
 *     limits and tie up a server process for the duration of the upload.
 *
 *  2. The resulting object must be publicly readable. Neither Meta nor TikTok
 *     accept a file upload for this flow — both are handed a URL and fetch the
 *     media themselves, from their own infrastructure, with no credentials.
 */

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const env = getEnv();

  if (!env.S3_ENDPOINT || !env.S3_BUCKET) {
    throw new Error(
      "Media storage is not configured. Set S3_ENDPOINT, S3_BUCKET, " +
        "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY — see .env.example.",
    );
  }

  client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    // R2 and most S3-compatible providers require path-style addressing.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export interface PresignedUpload {
  uploadUrl: string;
  storageKey: string;
  publicUrl: string;
  expiresInSeconds: number;
}

export async function createPresignedUpload(
  filename: string,
  mimeType: string,
): Promise<PresignedUpload> {
  const env = getEnv();
  const extension = filename.includes(".") ? filename.split(".").pop() : undefined;

  // Date-prefixed keys keep the bucket browsable and make lifecycle rules
  // (e.g. "expire unreferenced uploads after 90 days") straightforward.
  const now = new Date();
  const storageKey = [
    "media",
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    `${randomUUID()}${extension ? `.${extension}` : ""}`,
  ].join("/");

  const expiresInSeconds = 900;
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
    }),
    { expiresIn: expiresInSeconds },
  );

  return {
    uploadUrl,
    storageKey,
    publicUrl: publicUrlFor(storageKey),
    expiresInSeconds,
  };
}

export function publicUrlFor(storageKey: string): string {
  const base = getEnv().S3_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/${storageKey}`;
}

export async function deleteObject(storageKey: string): Promise<void> {
  const env = getEnv();
  await getClient().send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }),
  );
}

/**
 * Confirms the platform can actually reach the media before we queue a post.
 *
 * This catches the single most common cause of a failed publish: a bucket that
 * works fine from the browser (which has a session) but is not public, so
 * Meta's or TikTok's fetcher gets a 403. Finding that out here, at upload time,
 * is far better than at 07:00 when the post was meant to go out.
 */
export async function verifyPubliclyReachable(
  url: string,
): Promise<{ reachable: boolean; status?: number; reason?: string }> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (response.ok) return { reachable: true, status: response.status };
    return {
      reachable: false,
      status: response.status,
      reason:
        response.status === 403 || response.status === 401
          ? "The media URL requires authentication. Instagram and TikTok fetch media anonymously, " +
            "so the bucket (or a public domain in front of it) must allow unauthenticated reads."
          : `The media URL returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return { reachable: false, reason: `Could not reach the media URL: ${(error as Error).message}` };
  }
}
