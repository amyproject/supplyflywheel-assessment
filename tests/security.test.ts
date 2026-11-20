import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { freshDb, makeAdmin, makeCandidateWithAttempt, WEBM } from "./helpers";
import { createSession, SESSION_COOKIE, createUser, authenticate, createLoginLink, consumeLoginLink } from "@/lib/auth";
import { candidateView, saveAnswer, submitAttempt, acceptInvitation, createInvitation, invitationByToken, reissueInvitation } from "@/lib/assessment";
import { attemptDetail, dashboardRows, exportCsv } from "@/lib/admin";
import { saveRecording, signedMediaUrl, authorizeMedia, deleteRecording } from "@/lib/recordings";
import { GET as getAttemptRoute } from "@/app/api/attempts/[id]/route";
import { PATCH as patchAnswerRoute } from "@/app/api/attempts/[id]/answers/[questionId]/route";
import { GET as adminCandidatesRoute } from "@/app/api/admin/candidates/route";
import { GET as adminAttemptRoute } from "@/app/api/admin/attempts/[id]/route";
import { POST as reviewRoute } from "@/app/api/admin/reviews/route";

function req(url: string, token?: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: "localhost:3230" };
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  if (init.origin !== null) headers.origin = init.origin ?? "http://localhost:3230";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3230"), { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = <P>(p: P) => ({ params: Promise.resolve(p) });

describe("object-level authorization", () => {
  beforeEach(freshDb);

  it("candidate A cannot read or write candidate B's attempt (lib + API)", async () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    const B = makeCandidateWithAttempt(admin, "b@test.dev");
    expect(() => candidateView(A.candidate, B.attempt.id)).toThrow(/Not found|未找到/);
    expect(() => saveAnswer(A.candidate, B.attempt.id, "A1", { rev: 1, typed_text: "x" })).toThrow();

    const tokenA = createSession(A.candidate.id).token;
    const r1 = await getAttemptRoute(req(`/api/attempts/${B.attempt.id}`, tokenA), ctx({ id: B.attempt.id }));
    expect(r1.status).toBe(404);
    const r2 = await patchAnswerRoute(req(`/api/attempts/${B.attempt.id}/answers/A1`, tokenA, { method: "PATCH", body: { rev: 5, typed_text: "hack" } }), ctx({ id: B.attempt.id, questionId: "A1" }));
    expect(r2.status).toBe(404);
    expect(candidateView(B.candidate, B.attempt.id).answers.find((x) => x.question_code === "A1")!.typed_text).toBe("");
    const own = await getAttemptRoute(req(`/api/attempts/${A.attempt.id}`, tokenA), ctx({ id: A.attempt.id }));
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(JSON.stringify(body)).not.toContain("rubric");
  });

  it("candidate A cannot play candidate B's audio even with a URL signed for B", () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    const B = makeCandidateWithAttempt(admin, "b@test.dev");
    const rec = saveRecording(B.candidate, B.attempt.id, "A1", { bytes: WEBM, mime: "audio/webm;codecs=opus", duration_seconds: 5 });
    const urlForB = new URL(signedMediaUrl(rec.id, B.candidate.id), "http://x");
    const params = { exp: urlForB.searchParams.get("exp"), sig: urlForB.searchParams.get("sig"), dl: false };
    expect(() => authorizeMedia(A.candidate, rec.id, params)).toThrow(/Invalid|无效/);
    const urlForA = new URL(signedMediaUrl(rec.id, A.candidate.id), "http://x");
    expect(() => authorizeMedia(A.candidate, rec.id, { exp: urlForA.searchParams.get("exp"), sig: urlForA.searchParams.get("sig"), dl: false })).toThrow(/Not found|未找到/);
    expect(authorizeMedia(B.candidate, rec.id, params).recording.id).toBe(rec.id);
    // Admin can play with their own signature; candidates can't download.
    const adminUrl = new URL(signedMediaUrl(rec.id, admin.id), "http://x");
    expect(authorizeMedia(admin, rec.id, { exp: adminUrl.searchParams.get("exp"), sig: adminUrl.searchParams.get("sig"), dl: false }).recording.id).toBe(rec.id);
    const dlB = new URL(signedMediaUrl(rec.id, B.candidate.id, { download: true }), "http://x");
    expect(() => authorizeMedia(B.candidate, rec.id, { exp: dlB.searchParams.get("exp"), sig: dlB.searchParams.get("sig"), dl: true })).toThrow(/Forbidden/);
  });

  it("expired media signatures are rejected", () => {
    const admin = makeAdmin();
    const B = makeCandidateWithAttempt(admin, "b@test.dev");
    const rec = saveRecording(B.candidate, B.attempt.id, "A1", { bytes: WEBM, mime: "audio/webm", duration_seconds: 5 });
    expect(() => authorizeMedia(B.candidate, rec.id, { exp: String(Math.floor(Date.now() / 1000) - 1), sig: "x", dl: false })).toThrow(/expired|过期/);
  });

  it("non-admins get 403 from admin APIs; admins get data", async () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    const tokenA = createSession(A.candidate.id).token;
    expect((await adminCandidatesRoute(req("/api/admin/candidates", tokenA), ctx({}))).status).toBe(403);
    expect((await adminCandidatesRoute(req("/api/admin/candidates"), ctx({}))).status).toBe(403 - 2); // 401 unauthenticated
    expect((await adminAttemptRoute(req(`/api/admin/attempts/${A.attempt.id}`, tokenA), ctx({ id: A.attempt.id }))).status).toBe(403);
    const rv = await reviewRoute(req("/api/admin/reviews", tokenA, { method: "POST", body: { attempt_id: A.attempt.id, question_code: "A1", score: 5 } }), ctx({}));
    expect(rv.status).toBe(403);
    expect(() => dashboardRows(A.candidate)).toThrow();
    expect(() => exportCsv(A.candidate, {})).toThrow();
    const tokenAdmin = createSession(admin.id).token;
    const ok = await adminCandidatesRoute(req("/api/admin/candidates", tokenAdmin), ctx({}));
    expect(ok.status).toBe(200);
    expect((await ok.json()).total).toBe(1);
  });

  it("cross-origin mutations are blocked (CSRF)", async () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    const tokenA = createSession(A.candidate.id).token;
    const evil = await patchAnswerRoute(req(`/api/attempts/${A.attempt.id}/answers/A1`, tokenA, { method: "PATCH", body: { rev: 1, typed_text: "x" }, origin: "https://evil.example" }), ctx({ id: A.attempt.id, questionId: "A1" }));
    expect(evil.status).toBe(403);
    const none = await patchAnswerRoute(req(`/api/attempts/${A.attempt.id}/answers/A1`, tokenA, { method: "PATCH", body: { rev: 1, typed_text: "x" }, origin: null }), ctx({ id: A.attempt.id, questionId: "A1" }));
    expect(none.status).toBe(403);
  });
});

describe("authentication + invitations", () => {
  beforeEach(freshDb);

  it("wrong password and unknown email fail the same way", () => {
    createUser({ email: "x@test.dev", full_name: "X", password: "correct-horse-1", role: "candidate" });
    expect(() => authenticate("x@test.dev", "nope")).toThrow(/Incorrect/);
    expect(() => authenticate("ghost@test.dev", "nope")).toThrow(/Incorrect/);
    expect(authenticate("X@Test.dev ", "correct-horse-1").email).toBe("x@test.dev");
  });

  it("invitation tokens are single-use and reissue invalidates the old link", () => {
    const admin = makeAdmin();
    const { token, invitation } = createInvitation(admin, { email: "c@test.dev", full_name: "C" });
    const { token: token2 } = reissueInvitation(admin, invitation.id);
    expect(invitationByToken(token).state).toBe("invalid");
    expect(invitationByToken(token2).state).toBe("valid");
    acceptInvitation(token2, { actor: null, password: "long-enough-pw" });
    expect(() => acceptInvitation(token2, { actor: null, password: "long-enough-pw" })).toThrow();
  });

  it("an invitation for another email cannot be accepted by a signed-in candidate", () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    const { token } = createInvitation(admin, { email: "other@test.dev", full_name: "O" });
    expect(() => acceptInvitation(token, { actor: A.candidate })).toThrow(/different email|其他邮箱/);
  });

  it("sign-in links work once", () => {
    const u = createUser({ email: "m@test.dev", full_name: "M", role: "candidate" });
    const t = createLoginLink(u.id);
    expect(consumeLoginLink(t)?.id).toBe(u.id);
    expect(consumeLoginLink(t)).toBeNull();
  });
});

describe("submission locking + admin view", () => {
  beforeEach(freshDb);

  it("submission is idempotent and locks answers and recordings", () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    saveAnswer(A.candidate, A.attempt.id, "A1", { rev: 1, typed_text: "先做BOM分析" });
    const rec = saveRecording(A.candidate, A.attempt.id, "A2", { bytes: WEBM, mime: "audio/webm", duration_seconds: 3 });
    const s1 = submitAttempt(A.candidate, A.attempt.id);
    const s2 = submitAttempt(A.candidate, A.attempt.id);
    expect(s1.submitted_at).toBe(s2.submitted_at);
    expect(s1.receipt).toBe(s2.receipt);
    expect(() => saveAnswer(A.candidate, A.attempt.id, "A1", { rev: 2, typed_text: "改答案" })).toThrow(/locked|锁定/);
    expect(() => deleteRecording(A.candidate, rec.id)).toThrow(/locked|锁定/);
    expect(() => saveRecording(A.candidate, A.attempt.id, "A3", { bytes: WEBM, mime: "audio/webm", duration_seconds: 3 })).toThrow(/locked|锁定/);
    const detail = attemptDetail(admin, A.attempt.id);
    expect(detail.questions.find((q) => q.question.code === "A1")!.answer.typed_text).toBe("先做BOM分析");
    expect(detail.questions.find((q) => q.question.code === "A2")!.recording?.play_url).toMatch(/^\/api\/media\//);
  });

  it("recording requires consent and rejects non-audio bytes and unsupported types", () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev", false);
    expect(() => saveRecording(A.candidate, A.attempt.id, "A1", { bytes: WEBM, mime: "audio/webm", duration_seconds: 3 })).toThrow(/consent|同意/);
    const B = makeCandidateWithAttempt(admin, "b@test.dev");
    expect(() => saveRecording(B.candidate, B.attempt.id, "A1", { bytes: Buffer.from("<html>not audio</html>"), mime: "audio/webm", duration_seconds: 3 })).toThrow(/valid audio|有效音频/);
    expect(() => saveRecording(B.candidate, B.attempt.id, "A1", { bytes: WEBM, mime: "video/mp4", duration_seconds: 3 })).toThrow(/Unsupported|不支持/);
    expect(() => saveRecording(B.candidate, B.attempt.id, "A1", { bytes: WEBM, mime: "audio/webm", duration_seconds: 99999 })).toThrow(/duration|时长/);
  });

  it("CSV export neutralizes formula injection", () => {
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    saveAnswer(A.candidate, A.attempt.id, "A1", { rev: 1, typed_text: "=HYPERLINK(\"http://evil\")" });
    const csv = exportCsv(admin, {}, "answers");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe("delete candidate", () => {
  beforeEach(freshDb);
  it("admins delete a candidate with their attempt, answers, recordings and files; candidates can't", async () => {
    const fs = await import("node:fs");
    const { deleteCandidate } = await import("@/lib/admin");
    const { db } = await import("@/lib/db");
    const admin = makeAdmin();
    const A = makeCandidateWithAttempt(admin, "a@test.dev");
    const B = makeCandidateWithAttempt(admin, "b@test.dev");
    saveAnswer(A.candidate, A.attempt.id, "A1", { rev: 1, typed_text: "x" });
    const rec = saveRecording(A.candidate, A.attempt.id, "A2", { bytes: WEBM, mime: "audio/webm", duration_seconds: 2 });
    const file = `/tmp/sfa-test-storage/${rec.storage_path}`;
    expect(fs.existsSync(file)).toBe(true);
    expect(() => deleteCandidate(B.candidate, A.candidate.id)).toThrow();
    expect(() => deleteCandidate(admin, admin.id)).toThrow(/Not found/);
    expect(deleteCandidate(admin, A.candidate.id)).toEqual({ attempts: 1, recordings: 1 });
    expect(fs.existsSync(file)).toBe(false);
    expect(db().prepare("SELECT COUNT(*) n FROM answers WHERE attempt_id = ?").get(A.attempt.id)).toEqual({ n: 0 });
    expect(dashboardRows(admin).map((r) => r.email)).toEqual(["b@test.dev"]);
  });
});
