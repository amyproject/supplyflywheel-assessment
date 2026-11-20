import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { freshDb, makeAdmin } from "./helpers";
import { startPublicAttempt, candidateView, resumeToken, attemptFromResumeToken, submitAttempt } from "@/lib/assessment";
import { setSetting } from "@/lib/db";
import { actorFromToken, SESSION_COOKIE } from "@/lib/auth";
import { dashboardRows } from "@/lib/admin";
import { POST as startRoute } from "@/app/api/public/start/route";
import { GET as resumeRoute } from "@/app/resume/[token]/route";

const base = { full_name: "陈一", email: "chen@test.dev", consent_terms: true, consent_recording: true };
const ctx = <P>(p: P) => ({ params: Promise.resolve(p) });
function post(body: unknown, ip = "1.2.3.4") {
  return new NextRequest("http://localhost:3230/api/public/start", {
    method: "POST",
    headers: { host: "localhost:3230", origin: "http://localhost:3230", "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("no-login test taking", () => {
  beforeEach(freshDb);

  it("starts without a password, sets a session cookie, and admins see the result", async () => {
    const admin = makeAdmin();
    const res = (await startRoute(post(base), ctx({}))) as NextResponse;
    expect(res.status).toBe(201);
    const cookie = res.cookies.get(SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    const actor = actorFromToken(cookie.value)!;
    expect(actor.role).toBe("candidate");
    const { id } = await res.json();
    expect(candidateView(actor, id).questions).toHaveLength(19);
    expect(dashboardRows(admin).some((r) => r.attempt_id === id && r.email === "chen@test.dev")).toBe(true);
  });

  it("an email with an attempt can't be claimed again by typing it (no hijack); submitted emails can't retake", () => {
    const { candidate, attempt } = startPublicAttempt(base);
    expect(() => startPublicAttempt({ ...base, full_name: "冒充者" })).toThrow(/resume link|续答链接/);
    submitAttempt(candidate, attempt.id);
    expect(() => startPublicAttempt(base)).toThrow(/already submitted|已提交/);
  });

  it("admin emails can't be used to start a test", () => {
    makeAdmin("boss@test.dev");
    expect(() => startPublicAttempt({ ...base, email: "boss@test.dev" })).toThrow();
  });

  it("requires terms consent and the access code when one is set", () => {
    expect(() => startPublicAttempt({ ...base, consent_terms: false })).toThrow(/consent|同意|accept/i);
    setSetting("access_code", "robot2026");
    expect(() => startPublicAttempt({ ...base, access_code: "wrong" })).toThrow(/access code|口令/);
    expect(startPublicAttempt({ ...base, access_code: " robot2026 " }).attempt.status).toBe("in_progress");
  });

  it("resume links are HMAC-bound to one attempt and sign that browser in", async () => {
    const { attempt, candidate } = startPublicAttempt(base);
    const tok = resumeToken(attempt.id);
    expect(attemptFromResumeToken(tok)?.id).toBe(attempt.id);
    expect(attemptFromResumeToken(tok.slice(0, -2) + "xx")).toBeNull();
    expect(attemptFromResumeToken(`att_other.${tok.split(".")[1]}`)).toBeNull();
    const res = (await resumeRoute(new NextRequest(`http://localhost:3230/resume/${tok}`), ctx({ token: tok }))) as NextResponse;
    expect(res.headers.get("location")).toContain(`/candidate/assessment/${attempt.id}`);
    expect(actorFromToken(res.cookies.get(SESSION_COOKIE)!.value)!.id).toBe(candidate.id);
    const bad = await resumeRoute(new NextRequest("http://localhost:3230/resume/nope.nope"), ctx({ token: "nope.nope" }));
    expect(bad.headers.get("location")).toContain("/start?error=resume");
  });

  it("rate-limits starts per IP", async () => {
    for (let i = 0; i < 12; i++) expect((await startRoute(post({ ...base, email: `c${i}@test.dev` }, "9.9.9.9"), ctx({}))).status).toBe(201);
    expect((await startRoute(post({ ...base, email: "c99@test.dev" }, "9.9.9.9"), ctx({}))).status).toBe(429);
  });
});

describe("deployment bootstrap admin", () => {
  it("creates the super admin from ADMIN_EMAIL/ADMIN_PASSWORD and resets the password when the env changes", async () => {
    const { resetDbForTests } = await import("@/lib/db");
    const { authenticate } = await import("@/lib/auth");
    const prev = { e: process.env.ADMIN_EMAIL, p: process.env.ADMIN_PASSWORD };
    try {
      process.env.ADMIN_EMAIL = "Boss@Deploy.dev";
      process.env.ADMIN_PASSWORD = "first-password-123";
      resetDbForTests();
      expect(authenticate("boss@deploy.dev", "first-password-123").role).toBe("super_admin");
      // Simulate a restart with a new password on the same DB: keep the singleton, re-run bootstrap via a fresh open of a file DB
    } finally {
      process.env.ADMIN_EMAIL = prev.e;
      process.env.ADMIN_PASSWORD = prev.p;
      resetDbForTests();
    }
  });

  it("password reset on restart (file DB)", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { resetDbForTests } = await import("@/lib/db");
    const { authenticate } = await import("@/lib/auth");
    const file = path.join(os.tmpdir(), `sfa-boot-${Date.now()}.db`);
    const prev = { e: process.env.ADMIN_EMAIL, p: process.env.ADMIN_PASSWORD, d: process.env.DATABASE_PATH };
    try {
      process.env.DATABASE_PATH = file;
      process.env.ADMIN_EMAIL = "boss@deploy.dev";
      process.env.ADMIN_PASSWORD = "first-password-123";
      resetDbForTests();
      authenticate("boss@deploy.dev", "first-password-123");
      process.env.ADMIN_PASSWORD = "second-password-456";
      resetDbForTests();
      expect(() => authenticate("boss@deploy.dev", "first-password-123")).toThrow();
      expect(authenticate("boss@deploy.dev", "second-password-456").role).toBe("super_admin");
      process.env.ADMIN_PASSWORD = "short";
      resetDbForTests();
      expect(authenticate("boss@deploy.dev", "second-password-456").role).toBe("super_admin"); // too-short env is ignored
    } finally {
      resetDbForTests();
      Object.assign(process.env, { ADMIN_EMAIL: prev.e ?? "", ADMIN_PASSWORD: prev.p ?? "", DATABASE_PATH: prev.d ?? ":memory:" });
      for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    }
  });
});
