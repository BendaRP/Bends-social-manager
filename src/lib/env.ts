import { z } from "zod";

/**
 * Environment validation. Fails fast at boot rather than at 3am when a
 * scheduled post tries to publish and discovers the S3 bucket was never set.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_URL: z.string().url(),

  ENCRYPTION_MASTER_KEY: z
    .string()
    .min(1, "ENCRYPTION_MASTER_KEY is required — see .env.example"),
  ENCRYPTION_KEY_ID: z.string().default("v1"),
  SESSION_SECRET: z.string().min(1),

  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_GRAPH_VERSION: z.string().default("v23.0"),

  TIKTOK_CLIENT_KEY: z.string().default(""),
  TIKTOK_CLIENT_SECRET: z.string().default(""),

  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_PUBLIC_BASE_URL: z.string().default(""),

  AUDIENCE_TIMEZONE: z.string().default("Asia/Jerusalem"),
  REQUIRE_MANUAL_APPROVAL: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  TIKTOK_CLIENT_AUDITED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook — lets suites swap the environment without re-importing modules. */
export function resetEnvCache(): void {
  cached = null;
}
