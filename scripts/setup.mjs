#!/usr/bin/env node
/**
 * Interactive first-time setup.
 *
 *   npm run setup
 *
 * Written in plain Node with no dependencies so it runs before anything else
 * is installed or configured. It collapses what would otherwise be a dozen
 * error-prone manual steps — generating keys, writing .env, provisioning the
 * database, running migrations, creating the owner account — into one guided
 * pass, and never overwrites something that already exists.
 *
 * Two database paths are supported, because Docker is not available on every
 * machine: locked-down work laptops and any PC with virtualisation disabled in
 * firmware cannot run Docker Desktop at all. Free hosted Postgres and Redis
 * need no virtualisation and no local install, so that path is a first-class
 * option here rather than a footnote in the docs.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });

const say = (msg = "") => console.log(msg);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);
const fail = (msg) => console.log(`  ✗ ${msg}`);

function has(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore", shell: true }).status === 0;
}

function run(command, options = {}) {
  return execSync(command, { stdio: "inherit", ...options });
}

/** Rewrites a single key in .env, preserving comments and everything else. */
function setEnvValue(key, value) {
  let env = readFileSync(".env", "utf8");
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  env = pattern.test(env) ? env.replace(pattern, line) : `${env}\n${line}\n`;
  writeFileSync(".env", env);
}

function getEnvValue(key) {
  if (!existsSync(".env")) return null;
  const match = new RegExp(`^${key}="?([^"\n]*)"?$`, "m").exec(readFileSync(".env", "utf8"));
  return match?.[1] ?? null;
}

async function main() {
  say();
  say("הקמה ראשונית — מנהל הסושיאל");
  say("═".repeat(52));

  // --- 1. Prerequisites -------------------------------------------------
  say();
  say("1. בדיקת דרישות");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) {
    fail(`Node.js גרסה ${process.versions.node} — נדרשת 20 ומעלה.`);
    say("     להורדה: https://nodejs.org (לבחור LTS)");
    process.exit(1);
  }
  ok(`Node.js ${process.versions.node}`);

  // --- 2. Environment file ---------------------------------------------
  say();
  say("2. קובץ ההגדרות");

  if (existsSync(".env")) {
    ok(".env כבר קיים — הערכים הקיימים נשמרים");
    const added = backfillEnvKeys();
    if (added.length > 0) {
      ok(`נוספו הגדרות חדשות: ${added.join(", ")}`);
      say("     (ריקות, עם ההסבר שלהן — ראה בסוף הקובץ)");
    }
  } else {
    let env = readFileSync(".env.example", "utf8");

    // Generated rather than asked for: these must be high-entropy random
    // values, and a human choosing them is the weakest link in the chain.
    env = env
      .replace('ENCRYPTION_MASTER_KEY=""', `ENCRYPTION_MASTER_KEY="${randomBytes(32).toString("base64")}"`)
      .replace('SESSION_SECRET=""', `SESSION_SECRET="${randomBytes(32).toString("base64")}"`)
      .replace(/^APP_URL=.*$/m, 'APP_URL="http://localhost:3000"');

    writeFileSync(".env", env);
    ok(".env נוצר, עם מפתחות הצפנה אקראיים");
    say("     המפתחות מצפינים את הטוקנים של החשבונות שלך.");
    say("     אל תשתף את הקובץ ואל תעלה אותו לאינטרנט.");
  }

  // --- 3. Dependencies --------------------------------------------------
  say();
  say("3. התקנת ספריות");
  if (existsSync("node_modules")) {
    ok("כבר מותקן");
  } else {
    say("     (לוקח דקה או שתיים)");
    run("npm install");
    ok("הותקן");
  }

  // --- 4. Database ------------------------------------------------------
  say();
  say("4. בסיס הנתונים");

  const dockerUsable = has("docker") && dockerDaemonResponds();

  if (dockerUsable) {
    ok("Docker זמין");
    if (!(await tryDocker())) {
      await configureHostedDatabases("Docker לא הצליח להפעיל את בסיס הנתונים.");
    }
  } else {
    warn("Docker לא זמין במחשב הזה.");
    say("     סיבות נפוצות: וירטואליזציה כבויה ב-BIOS, או מדיניות אבטחה של מקום העבודה.");
    say("     זו לא בעיה — נשתמש בבסיס נתונים בענן, בחינם ובלי שום התקנה.");
    await configureHostedDatabases();
  }

  // --- 5. Schema --------------------------------------------------------
  say();
  say("5. יצירת הטבלאות");
  try {
    run("npx prisma migrate deploy");
    run("npx prisma generate");
    ok("מוכן");
  } catch {
    fail("יצירת הטבלאות נכשלה — כנראה כתובת בסיס נתונים שגויה ב-.env");
    process.exit(1);
  }

  // --- 6. Owner account -------------------------------------------------
  say();
  say("6. משתמש הבעלים");
  await createOwner();

  // --- Done -------------------------------------------------------------
  say();
  say("═".repeat(52));
  say("ההקמה הושלמה.");
  say();
  say("להפעלה:   npm run dev:all");
  say("ואז לפתוח: http://localhost:3000");
  say();
  say("בשלב זה אפשר להתחבר ולראות את הממשק. כדי לפרסם בפועל");
  say("צריך לחבר חשבונות — ההמשך ב-docs/LOCAL.md");
  say();

  rl.close();
}

/**
 * Adds configuration keys that exist in .env.example but not yet in .env.
 *
 * .env holds the user's secrets and is never overwritten, so a `git pull` that
 * introduces a new setting leaves existing installs without it — the option
 * simply appears not to exist, with nothing indicating it was added. Existing
 * values are never touched; only genuinely absent keys are appended, with the
 * comment block that explains them.
 */
function backfillEnvKeys() {
  const example = readFileSync(".env.example", "utf8");
  const current = readFileSync(".env", "utf8");

  const keyOf = (line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1] ?? null;

  const existing = new Set(
    current.split("\n").map(keyOf).filter(Boolean),
  );

  const lines = example.split("\n");
  const added = [];
  const additions = [];

  for (let i = 0; i < lines.length; i++) {
    const key = keyOf(lines[i] ?? "");
    if (!key || existing.has(key)) continue;

    // Carry the preceding comment block across, since it is what explains what
    // the setting is for.
    const comment = [];
    for (let j = i - 1; j >= 0; j--) {
      const line = lines[j] ?? "";
      if (line.trim().startsWith("#")) comment.unshift(line);
      else break;
    }

    additions.push("", ...comment, lines[i] ?? "");
    added.push(key);
  }

  if (added.length === 0) return [];

  writeFileSync(
    ".env",
    `${current.replace(/\n+$/, "")}\n\n# --- נוספו אוטומטית בהרצת npm run setup ---${additions.join("\n")}\n`,
  );
  return added;
}

function dockerDaemonResponds() {
  // `docker --version` answers even when the engine is not running, which on
  // Windows is the usual state when virtualisation is unavailable. Only an
  // actual API call tells us whether Docker can do anything.
  return spawnSync("docker", ["info"], { stdio: "ignore", shell: true }).status === 0;
}

async function tryDocker() {
  try {
    run("docker compose up -d");
    say("     ממתין שבסיס הנתונים יהיה מוכן…");
    await waitForPostgres();
    ok("Postgres ו-Redis רצים מקומית");
    return true;
  } catch {
    return false;
  }
}

/**
 * Collects hosted database URLs.
 *
 * Both services are free-tier and need nothing installed locally, which is what
 * makes this a complete alternative to Docker rather than a workaround.
 */
async function configureHostedDatabases(reason) {
  if (reason) warn(reason);

  say();
  say("   נשתמש בשני שירותי ענן חינמיים. שניהם הרשמה מהירה ובלי כרטיס אשראי:");
  say();
  say("   א. בסיס נתונים — Neon");
  say("      1. להיכנס ל-https://neon.tech ולהירשם (אפשר עם חשבון Google)");
  say("      2. ליצור פרויקט חדש");
  say("      3. להעתיק את ה-Connection string — מתחיל ב-postgresql://");
  say();
  say("   ב. תור עבודות — Redis Cloud");
  say("      1. להיכנס ל-https://redis.io/try-free ולהירשם");
  say("      2. ליצור מסד חדש (Free 30MB)");
  say("      3. להעתיק את ה-Public endpoint ואת הסיסמה, ולהרכיב:");
  say("         redis://default:הסיסמה@הכתובת:הפורט");
  say();
  say("   (בחרתי ב-Redis Cloud ולא באלטרנטיבות כי אין בו מגבלת פקודות —");
  say("    תור העבודות שולח הרבה פקודות קטנות ברקע.)");
  say();

  const existingDb = getEnvValue("DATABASE_URL");
  const dbIsLocal = !existingDb || existingDb.includes("localhost");

  if (!dbIsLocal) {
    ok("DATABASE_URL כבר מוגדר לכתובת מרוחקת — משאיר אותו");
  } else {
    const url = await askUntilValid(
      "   הדבק כאן את כתובת ה-Postgres: ",
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "   הכתובת צריכה להתחיל ב-postgresql://",
    );
    setEnvValue("DATABASE_URL", url);
    ok("כתובת בסיס הנתונים נשמרה");
  }

  const existingRedis = getEnvValue("REDIS_URL");
  if (existingRedis && !existingRedis.includes("localhost")) {
    ok("REDIS_URL כבר מוגדר לכתובת מרוחקת — משאיר אותו");
  } else {
    setEnvValue("REDIS_URL", await askForRedisUrl());
    ok("כתובת ה-Redis נשמרה");
  }

  // Verify now, while the user is here to fix a typo. A bad connection string
  // discovered later surfaces as a confusing failure at publish time.
  say();
  say("   בודק את החיבורים…");
  await verifyConnections();
}

async function verifyConnections() {
  process.env.DATABASE_URL = getEnvValue("DATABASE_URL");
  process.env.REDIS_URL = getEnvValue("REDIS_URL");

  try {
    const IORedis = (await import("ioredis")).default;
    const redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 10_000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    redis.disconnect();
    ok("Redis מגיב");
  } catch (error) {
    fail(`חיבור ל-Redis נכשל: ${error.message}`);
    say("     לבדוק את הכתובת ב-.env ולהריץ שוב: npm run setup");
    process.exit(1);
  }
}

/**
 * Collects the Redis URL, either whole or assembled from its parts.
 *
 * Hosted Redis passwords are random and regularly contain characters that are
 * syntactically meaningful in a URL — an "@" in the password splits the
 * authority section and the connection fails with an error that points at the
 * host rather than the password. Building the URL here, with the password
 * percent-encoded, removes a failure the user has no way to diagnose.
 */
async function askForRedisUrl() {
  say();
  say("   אפשר להדביק את הכתובת המלאה (מכפתור Connect בקונסולה של Redis),");
  say("   או להקיש Enter כדי להרכיב אותה יחד משלושה שדות.");
  say();

  const pasted = (await rl.question("   כתובת מלאה, או Enter להרכבה: ")).trim();

  if (pasted === "") return assembleRedisUrl();

  if (/^rediss?:\/\//.test(pasted)) {
    try {
      new URL(pasted);
      return pasted;
    } catch {
      warn("הכתובת לא תקינה — כנראה תו מיוחד בסיסמה. נרכיב אותה יחד.");
      return assembleRedisUrl();
    }
  }

  warn("זו לא כתובת redis://. נרכיב אותה יחד.");
  return assembleRedisUrl();
}

async function assembleRedisUrl() {
  say();
  say("   בעמוד המסד ב-Redis Cloud:");
  say("   • Public endpoint — נראה כמו  redis-19024.c55.eu-central-1.ec2.redns.redis-cloud.com:19024");
  say("   • Password — מתחת ל-Security, מאחורי אייקון של עין");
  say();

  const endpoint = await askUntilValid(
    "   Public endpoint (כתובת:פורט): ",
    (value) => /^[^\s:]+:\d+$/.test(value.replace(/^rediss?:\/\//, "")),
    "   צריך להיראות כמו  שם-השרת:מספר-פורט",
  );

  const username =
    (await rl.question("   שם משתמש (Enter לברירת המחדל default): ")).trim() || "default";

  const password = await askUntilValid(
    "   סיסמה: ",
    (value) => value.length > 0,
    "   הסיסמה לא יכולה להיות ריקה",
  );

  const host = endpoint.replace(/^rediss?:\/\//, "");
  // Percent-encoding is what makes a password containing @ / : or # safe here.
  return `redis://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}`;
}

async function askUntilValid(prompt, isValid, hint) {
  for (;;) {
    const answer = (await rl.question(prompt)).trim();
    if (isValid(answer)) return answer;
    say(hint);
  }
}

async function createOwner() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    if ((await prisma.user.count()) > 0) {
      ok("כבר קיים משתמש — מדלג");
      return;
    }

    const email = (
      await askUntilValid(
        "   אימייל להתחברות: ",
        (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
        "   כתובת אימייל לא תקינה",
      )
    ).toLowerCase();

    const suggested = randomBytes(9).toString("base64url");
    const answer = (await rl.question(`   סיסמה (Enter כדי להשתמש ב-${suggested}): `)).trim();
    const password = answer || suggested;

    if (password.length < 12) {
      fail("הסיסמה חייבת להיות באורך 12 תווים לפחות");
      process.exit(1);
    }

    const bcrypt = (await import("bcryptjs")).default;
    await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 12) },
    });

    ok(`נוצר משתמש ${email}`);
    if (!answer) {
      say(`     סיסמה: ${password}`);
      say("     שמור אותה עכשיו — היא לא תוצג שוב.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Polls until Postgres answers, rather than sleeping a fixed guess. */
async function waitForPostgres(attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    const probe = spawnSync(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "bends"],
      { stdio: "ignore" },
    );
    if (probe.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Postgres did not become ready");
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
