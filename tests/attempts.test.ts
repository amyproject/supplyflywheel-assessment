import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { freshDb, makeAdmin, makeCandidateWithAttempt } from "./helpers";
import { candidateView, saveAnswer, submitAttempt, startAttempt, publishTemplateSettings, currentTemplate, extendAttempt, reopenAttempt, saveReview, recordClientEvents, eventsFor } from "@/lib/assessment";
import { db } from "@/lib/db";
import { scoreForAttempt, dashboardRows } from "@/lib/admin";
import { adminAttempt } from "@/lib/assessment";

describe("attempt lifecycle", () => {
  beforeEach(freshDb);
  afterEach(() => vi.useRealTimers());

  it("start is idempotent per invitation and snapshots 19 questions with a server start time", () => {
    const admin = makeAdmin();
    const { candidate, attempt, invitation } = makeCandidateWithAttempt(admin, "a@test.dev");
    const again = startAttempt(candidate, { invitation_id: invitation.id, consent_terms: true, consent_recording: true });
    expect(again.id).toBe(attempt.id);
    const v = candidateView(candidate, attempt.id);
    expect(v.questions).toHaveLength(19);
    expect(v.answers).toHaveLength(19);
    expect(Date.parse(v.attempt.started_at)).toBeLessThanOrEqual(Date.now());
    // default: 30-minute hard cap
    expect(Date.parse(v.attempt.deadline_at!) - Date.parse(v.attempt.started_at)).toBe(30 * 60_000);
    expect(v.settings.auto_submit_on_expiry).toBe(true);
    expect(v.questions[0].soft_limit_seconds).toBe(90);
  });

  it("requires terms consent; recording consent is separate and optional", () => {
    const admin = makeAdmin();
    const { candidate, invitation } = makeCandidateWithAttempt(admin, "a@test.dev", false);
    db().prepare("DELETE FROM attempts").run();
    expect(() => startAttempt(candidate, { invitation_id: invitation.id, consent_terms: false, consent_recording: true })).toThrow(/consent|同意|accept/i);
    const a = startAttempt(candidate, { invitation_id: invitation.id, consent_terms: true, consent_recording: false });
    expect(candidateView(candidate, a.id).attempt.recording_consent).toBe(false);
  });

  it("autosave is idempotent: stale revs never overwrite newer text; repeated seq never double-counts time", () => {
    const admin = makeAdmin();
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    saveAnswer(candidate, attempt.id, "A1", { rev: 2, typed_text: "新版本" });
    saveAnswer(candidate, attempt.id, "A1", { rev: 1, typed_text: "旧版本" }); // late retry
    saveAnswer(candidate, attempt.id, "A1", { rev: 2, typed_text: "重复" }); // duplicate rev
    expect(candidateView(candidate, attempt.id).answers[0].typed_text).toBe("新版本");

    const r1 = saveAnswer(candidate, attempt.id, "A1", { seq: 1, active_delta: 10 });
    const r2 = saveAnswer(candidate, attempt.id, "A1", { seq: 1, active_delta: 10 });
    expect(r1.active_duration_seconds).toBe(r2.active_duration_seconds);
  });

  it("active time deltas are clamped to wall-clock time since the last heartbeat", () => {
    const admin = makeAdmin();
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    saveAnswer(candidate, attempt.id, "A1", { seq: 1, active_delta: 5 });
    const r = saveAnswer(candidate, attempt.id, "A1", { seq: 2, active_delta: 3000 }); // client claims 50 minutes 1ms later
    expect(r.active_duration_seconds).toBeLessThanOrEqual(5 + 6);
  });

  it("survives a 'browser close': answers come back from the server", () => {
    const admin = makeAdmin();
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    for (const [i, code] of ["A1", "B2", "E3"].entries()) saveAnswer(candidate, attempt.id, code, { rev: i + 1, typed_text: `答案 ${code}` });
    const v = candidateView(candidate, attempt.id);
    expect(v.answers.filter((a) => a.answered).map((a) => a.question_code)).toEqual(["A1", "B2", "E3"]);
  });

  it("with auto-submit off, past the cap the attempt expires and the candidate can still finalize", () => {
    const admin = makeAdmin();
    publishTemplateSettings(admin, { recommended_minutes: 30, overall_limit_minutes: 30, auto_submit_on_expiry: false, copy_restriction_enabled: true, paste_restriction_enabled: true, allow_navigation: true, soft_limit_minutes: 1.5 });
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    saveAnswer(candidate, attempt.id, "A1", { rev: 1, typed_text: "草稿" });
    db().prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), attempt.id);
    expect(candidateView(candidate, attempt.id).attempt.status).toBe("expired");
    expect(() => saveAnswer(candidate, attempt.id, "A1", { rev: 2, typed_text: "超时修改" })).toThrow(/locked|锁定/);
    const s = submitAttempt(candidate, attempt.id);
    expect(s.status).toBe("submitted");
    expect(eventsFor(attempt.id).some((e) => e.event_type === "submitted" && e.metadata.includes("after_deadline"))).toBe(true);
  });

  it("the default 30-minute template auto-submits saved answers at the cap", () => {
    const admin = makeAdmin();
    expect(currentTemplate().version).toBe(1);
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    saveAnswer(candidate, attempt.id, "A1", { rev: 1, typed_text: "已保存的草稿" });
    db().prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), attempt.id);
    const v = candidateView(candidate, attempt.id);
    expect(v.attempt.status).toBe("submitted");
    expect(v.answers[0].typed_text).toBe("已保存的草稿");
  });

  it("template edits publish a new version; old attempts keep their snapshot", () => {
    const admin = makeAdmin();
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    publishTemplateSettings(admin, { recommended_minutes: 60, overall_limit_minutes: null, auto_submit_on_expiry: false, copy_restriction_enabled: false, paste_restriction_enabled: false, allow_navigation: false, soft_limit_minutes: 6 });
    const v = candidateView(candidate, attempt.id);
    expect(v.settings.version).toBe(1);
    expect(v.settings.copy_restriction_enabled).toBe(true);
    expect(v.questions[0].soft_limit_seconds).toBe(90);
  });

  it("admins can extend (with reason) and reopen a submitted attempt with an audit trail", () => {
    const admin = makeAdmin();
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    expect(() => extendAttempt(admin, attempt.id, 15, "")).toThrow(/Reason|原因/);
    const before = adminAttempt(admin, attempt.id).deadline_at!;
    extendAttempt(admin, attempt.id, 15, "网络中断");
    expect(Date.parse(adminAttempt(admin, attempt.id).deadline_at!) - Date.parse(before)).toBe(15 * 60_000);
    submitAttempt(candidate, attempt.id);
    reopenAttempt(admin, attempt.id, "候选人误提交");
    expect(candidateView(candidate, attempt.id).attempt.editable).toBe(true);
    const audits = db().prepare("SELECT action FROM admin_audit_logs WHERE target_id = ?").all(attempt.id) as { action: string }[];
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["extend_attempt", "reopen_attempt"]));
  });

  it("weighted total updates as reviews are saved; second reviewers are averaged", () => {
    const admin = makeAdmin();
    const admin2 = makeAdmin("rev2@test.dev", "admin");
    const { attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    const snap = currentTemplate();
    for (const q of snap.questions) saveReview(admin, attempt.id, q.code, { score: 4 });
    expect(scoreForAttempt(adminAttempt(admin, attempt.id)).final).toBe(80);
    saveReview(admin2, attempt.id, "E1", { score: 2, private_notes: "案例无法核实" });
    // E: (3 + 4 + 4)/3 = 3.667 → 7.33 ; 24 + 16*3 = 72 → 79.3
    expect(scoreForAttempt(adminAttempt(admin, attempt.id)).final).toBe(79.3);
    expect(() => saveReview(admin, attempt.id, "A1", { score: 6 })).toThrow();
    const row = dashboardRows(admin).find((r) => r.attempt_id === attempt.id)!;
    expect(row.score_is_final).toBe(true);
    expect(row.band).toBe("interview");
  });

  it("client integrity events: only known types, minimal metadata", () => {
    const admin = makeAdmin();
    const { candidate, attempt } = makeCandidateWithAttempt(admin, "a@test.dev");
    const r = recordClientEvents(candidate, attempt.id, [
      { type: "paste_blocked", question_code: "A1", meta: { length: 120, text: "x".repeat(500), nested: { a: 1 } } },
      { type: "keystroke_log", meta: {} },
    ]);
    expect(r.accepted).toBe(1);
    const e = eventsFor(attempt.id).find((x) => x.event_type === "paste_blocked")!;
    const meta = JSON.parse(e.metadata);
    expect(meta.text.length).toBe(80);
    expect(meta.nested).toBeUndefined();
  });
});

describe("template sync", () => {
  it("an existing DB with the old 20-question template gets a new 19-question version; old attempts keep E4", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { db: getDb, resetDbForTests, id } = await import("@/lib/db");
    const file = path.join(os.tmpdir(), `sfa-sync-${Date.now()}.db`);
    const prev = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = file;
    try {
      resetDbForTests();
      const t = currentTemplate();
      getDb().prepare("INSERT INTO questions (id, template_id, question_code, category, display_order, prompt_zh, prompt_en, rubric_zh, rubric_en, category_weight) VALUES (?, ?, 'E4', 'E', 20, '前90天', 'x', 'x', 'x', 10)").run(id("q"), t.id);
      const admin = makeAdmin();
      const { attempt, candidate } = makeCandidateWithAttempt(admin, "old@test.dev");
      expect(candidateView(candidate, attempt.id).questions).toHaveLength(20);
      resetDbForTests(); // reopen → sync runs
      const now = currentTemplate();
      expect(now.version).toBe(t.version + 1);
      expect(now.questions.map((q) => q.code)).not.toContain("E4");
      expect(now.questions).toHaveLength(19);
      expect(candidateView(candidate, attempt.id).questions).toHaveLength(20); // snapshot preserved
    } finally {
      resetDbForTests();
      process.env.DATABASE_PATH = prev;
      for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    }
  });
});
