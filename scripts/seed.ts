/**
 * npm run seed            → creates the first super admin from ADMIN_EMAIL / ADMIN_PASSWORD
 * npm run seed -- --demo  → also adds clearly-labelled demo candidates (fictional) for local testing
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
  const { startPublicAttempt, saveAnswer, submitAttempt, saveReview, currentTemplate } = await import("../src/lib/assessment");
  const email = process.env.ADMIN_EMAIL || "admin@supplyflywheel.dev";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set ADMIN_PASSWORD (12+ chars) in .env.local");
  let admin = findUserByEmail(email);
  if (!admin) {
    createUser({ email, full_name: "SupplyFlywheel Admin", password, role: "super_admin" });
    console.log(`created super admin ${email}`);
  } else console.log(`super admin exists: ${email}`);
  admin = findUserByEmail(email)!;

  if (!process.argv.includes("--demo")) return;
  const tpl = currentTemplate();
  const demo = [
    { email: "demo.zhang@example.com", name: "张三（演示）", submit: true, score: [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 4, 4, 5, 4, 4] },
    { email: "demo.li@example.com", name: "李四（演示）", submit: false, score: null },
    { email: "demo.wang@example.com", name: "王五（演示）", submit: true, score: [3, 3, 2, 3, 3, 4, 3, 2, 3, 3, 3, 3, 2, 3, 3, 3, null, null, null, null] },
  ];
  for (const d of demo) {
    if (findUserByEmail(d.email)) continue;
    const { candidate: c, attempt: a } = startPublicAttempt({ full_name: d.name, email: d.email, consent_terms: true, consent_recording: true });
    const n = d.submit ? tpl.questions.length : 12;
    tpl.questions.slice(0, n).forEach((q, i) => {
      saveAnswer(c, a.id, q.code, { rev: i + 1, typed_text: `【演示回答】针对${q.code}：${q.rubric_zh}。先明确需求与约束，再列出步骤、负责人与验证方式，并说明风险与备选方案。` });
    });
    if (d.submit) submitAttempt(c, a.id);
    d.score?.forEach((s, i) => s && tpl.questions[i] && saveReview(admin!, a.id, tpl.questions[i].code, { score: s }));
    console.log(`demo candidate ${d.email}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
