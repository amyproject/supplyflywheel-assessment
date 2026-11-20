/**
 * npm run seed            → creates the first super admin from ADMIN_EMAIL / ADMIN_PASSWORD
 */
import fs from "node:fs";
import path from "node:path";

// Load .env.local without a dependency.
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  const { createUser, findUserByEmail } = await import("../src/lib/auth");
    const email = process.env.ADMIN_EMAIL || "admin@supplyflywheel.dev";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set ADMIN_PASSWORD (12+ chars) in .env.local");
  let admin = findUserByEmail(email);
  if (!admin) {
    createUser({ email, full_name: "SupplyFlywheel Admin", password, role: "super_admin" });
    console.log(`created super admin ${email}`);
  } else console.log(`super admin exists: ${email}`);
  admin = findUserByEmail(email)!;

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
