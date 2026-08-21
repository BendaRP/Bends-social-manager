import { randomBytes } from "node:crypto";

// Deterministic test environment. A real key is generated rather than a
// placeholder so the crypto tests exercise the actual cipher path.
process.env.ENCRYPTION_MASTER_KEY ??= randomBytes(32).toString("base64");
process.env.ENCRYPTION_KEY_ID ??= "v1";
process.env.SESSION_SECRET ??= randomBytes(32).toString("base64");
process.env.APP_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??=
  "postgresql://bends:bends@localhost:5432/bends_social?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.AUDIENCE_TIMEZONE ??= "Asia/Jerusalem";
process.env.REQUIRE_MANUAL_APPROVAL ??= "true";

// Point the renderer at whichever Chromium this machine has. Playwright resolves
// its own download when this is unset, so CI and dev boxes need nothing here.
process.env.CHROMIUM_PATH ??= process.env.PLAYWRIGHT_BROWSERS_PATH
  ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`
  : "";
