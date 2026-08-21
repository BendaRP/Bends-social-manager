import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/server/db";
import { hashPassword } from "../src/server/auth";

/**
 * Creates the owner account.
 *
 * Run once after setting up the database:
 *   npm run create-owner
 *
 * There is no public sign-up page anywhere in the app — this script is the only
 * way an account comes into existence, so an exposed instance cannot have a new
 * user registered against it.
 */
async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const existing = await prisma.user.count();
    if (existing > 0) {
      const answer = await rl.question(
        `כבר קיימים ${existing} משתמשים. להוסיף עוד אחד? (yes/no) `,
      );
      if (answer.toLowerCase() !== "yes") {
        console.log("בוטל.");
        return;
      }
    }

    const email = (await rl.question("אימייל: ")).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("כתובת אימייל לא תקינה");
    }

    const suggested = randomBytes(12).toString("base64url");
    const password =
      (await rl.question(`סיסמה (Enter כדי להשתמש ב-${suggested}): `)).trim() || suggested;

    if (password.length < 12) {
      throw new Error("הסיסמה חייבת להיות באורך 12 תווים לפחות");
    }

    const name = (await rl.question("שם (אופציונלי): ")).trim();

    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash: await hashPassword(password),
      },
    });

    console.log(`\n✓ נוצר משתמש ${user.email}`);
    if (password === suggested) {
      console.log(`  סיסמה: ${password}`);
      console.log("  שמור אותה במנהל סיסמאות — היא לא תוצג שוב.");
    }
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).message}`);
  process.exit(1);
});
