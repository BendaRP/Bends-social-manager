import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads .env for processes Next.js does not start.
 *
 * The Next server reads .env itself, but the worker and the CLI scripts are
 * plain Node processes and do not. Until now they worked only because importing
 * Prisma happens to load .env as a side effect — which means a file that does
 * not import Prisma silently starts with no configuration, and a future Prisma
 * version dropping that behaviour would take the scheduler down with it.
 *
 * Import this first, before anything that reads process.env.
 */
export function loadEnvFile(): void {
  // Values already in the environment win: a container's real configuration
  // must not be overridden by a .env file that happens to be in the image.
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      // Node < 20.12 has no loadEnvFile, and a malformed file should not stop
      // a process whose environment may already be set another way.
    }
  }
}

loadEnvFile();
