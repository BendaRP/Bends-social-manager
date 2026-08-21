#!/usr/bin/env node
/**
 * Interactive first-time setup.
 *
 *   npm run setup
 *
 * Written in plain Node with no dependencies so it runs before anything else
 * is installed or configured. It collapses what would otherwise be eight
 * error-prone manual steps — generating keys, writing .env, starting the
 * database, running migrations, creating the owner account — into one guided
 * pass, and refuses to overwrite anything that already exists.
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
  const probe = spawnSync(command, ["--version"], { stdio: "ignore", shell: true });
  return probe.status === 0;
}

function run(command, options = {}) {
  return execSync(command, { stdio: "inherit", ...options });
}

async function main() {
  say();
  say("הקמה ראשונית — מנהל הסושיאל");
  say("═".repeat(50));

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

  const hasDocker = has("docker");
  if (hasDocker) {
    ok("Docker מותקן");
  } else {
    warn("Docker לא נמצא.");
    say("     Docker מריץ את בסיס הנתונים. להורדה: https://docker.com/products/docker-desktop");
    say("     אפשר גם להשתמש בשירות ענן חינמי במקום — ראה docs/LOCAL.md");
  }

  // --- 2. Environment file ---------------------------------------------
  say();
  say("2. קובץ ההגדרות");

  if (existsSync(".env")) {
    ok(".env כבר קיים — לא נוגע בו");
  } else {
    let env = readFileSync(".env.example", "utf8");

    // Generated rather than asked for: these must be high-entropy random
    // values, and a human choosing them is the weakest link in the chain.
    const key = randomBytes(32).toString("base64");
    const secret = randomBytes(32).toString("base64");

    env = env
      .replace('ENCRYPTION_MASTER_KEY=""', `ENCRYPTION_MASTER_KEY="${key}"`)
      .replace('SESSION_SECRET=""', `SESSION_SECRET="${secret}"`)
      .replace(/^APP_URL=.*$/m, 'APP_URL="http://localhost:3000"');

    writeFileSync(".env", env);
    ok(".env נוצר, עם מפתחות הצפנה אקראיים");
    say("     המפתחות האלה מצפינים את הטוקנים של החשבונות שלך.");
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

  if (hasDocker) {
    try {
      run("docker compose up -d");
      // Postgres accepts TCP connections a moment before it is ready to serve
      // queries; migrating too early fails with a confusing connection error.
      say("     ממתין שבסיס הנתונים יהיה מוכן…");
      await waitForPostgres();
      ok("Postgres ו-Redis רצים");
    } catch {
      fail("הפעלת Docker נכשלה. ודא ש-Docker Desktop פתוח ונסה שוב.");
      process.exit(1);
    }
  } else {
    warn("מדלג — Docker לא מותקן.");
    say("     יש למלא DATABASE_URL ו-REDIS_URL ב-.env ולהריץ שוב.");
    rl.close();
    return;
  }

  // --- 5. Schema --------------------------------------------------------
  say();
  say("5. יצירת הטבלאות");
  run("npx prisma migrate deploy");
  run("npx prisma generate");
  ok("מוכן");

  // --- 6. Owner account -------------------------------------------------
  say();
  say("6. משתמש הבעלים");

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.user.count();
    if (existing > 0) {
      ok(`כבר קיים משתמש — מדלג`);
    } else {
      const email = (await rl.question("   אימייל להתחברות: ")).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        fail("כתובת אימייל לא תקינה");
        process.exit(1);
      }

      const suggested = randomBytes(9).toString("base64url");
      const answer = (
        await rl.question(`   סיסמה (Enter כדי להשתמש ב-${suggested}): `)
      ).trim();
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
    }
  } finally {
    await prisma.$disconnect();
  }

  // --- Done -------------------------------------------------------------
  say();
  say("═".repeat(50));
  say("ההקמה הושלמה.");
  say();
  say("להפעלה:");
  say("   npm run dev:all");
  say();
  say("ואז לפתוח: http://localhost:3000");
  say();
  say("בשלב זה אפשר להתחבר ולראות את הממשק, אבל עדיין אי אפשר");
  say("לפרסם — לשם כך צריך לחבר חשבונות. ההמשך ב-docs/LOCAL.md");
  say();

  rl.close();
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
