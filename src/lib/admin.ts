import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db, parseJson } from "@/lib/db";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/http";
import { type Actor, isAdmin } from "@/lib/auth";
import {
  type AnswerRow,
  type AttemptRow,
  type AttemptStatus,
  INTEGRITY_EVENT_TYPES,
  accommodationsFor,
  adminAttempt,
  answersFor,
  audit,
  elapsedSeconds,
  eventsFor,
  isAnswered,
  liveRecordings,
  refreshExpiry,
  reviewsFor,
  snapshotOf,
  currentTemplate,
} from "@/lib/assessment";
import { band, summarize, type Band, type ScoreSummary } from "@/lib/scoring";
import { signedMediaUrl } from "@/lib/recordings";

function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new HttpError(403, "forbidden", "Forbidden");
}

export type DashboardStatus = "invited" | AttemptStatus | "archived";

export interface DashboardRow {
  candidate_id: string;
  full_name: string;
  email: string;
  location: string | null;
  invitation_id: string | null;
  attempt_id: string | null;
  status: DashboardStatus;
  answered: number;
  total: number;
  elapsed_seconds: number | null;
  active_seconds: number | null;
  started_at: string | null;
  submitted_at: string | null;
  score: number | null;
  score_is_final: boolean;
  scored: number;
  band: Band | null;
  integrity_events: number;
  open_accommodations: number;
}

export function scoreForAttempt(a: AttemptRow): ScoreSummary {
  const snap = snapshotOf(a);
  const reviews = reviewsFor(a.id)
    .filter((r) => r.score !== null)
    .map((r) => ({ question_code: r.question_code, score: r.score as number, reviewer_id: r.reviewer_id }));
  return summarize(snap.questions, snap.categories, reviews);
}

function rowForAttempt(a: AttemptRow, user: { id: string; full_name: string; email: string; location: string | null }): DashboardRow {
  const fresh = refreshExpiry(a);
  const snap = snapshotOf(fresh);
  const answers = answersFor(fresh.id);
  const recs = liveRecordings(fresh.id);
  const s = scoreForAttempt(fresh);
  const integrity = (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE attempt_id = ? AND event_type IN (${INTEGRITY_EVENT_TYPES.map(() => "?").join(",")})`)
      .get(fresh.id, ...INTEGRITY_EVENT_TYPES) as { n: number }
  ).n;
  const openAcc = (db().prepare("SELECT COUNT(*) AS n FROM accommodation_requests WHERE attempt_id = ? AND status = 'open'").get(fresh.id) as { n: number }).n;
  const score = s.final ?? s.provisional;
  return {
    candidate_id: user.id,
    full_name: user.full_name,
    email: user.email,
    location: user.location,
    invitation_id: fresh.invitation_id,
    attempt_id: fresh.id,
    status: fresh.archived_at ? "archived" : fresh.status,
    answered: answers.filter((x) => isAnswered(x, recs)).length,
    total: snap.questions.length,
    elapsed_seconds: elapsedSeconds(fresh),
    active_seconds: fresh.total_active_seconds,
    started_at: fresh.started_at,
    submitted_at: fresh.submitted_at,
    score,
    score_is_final: s.final !== null,
    scored: s.scoredQuestions,
    band: band(s.final),
    integrity_events: integrity,
    open_accommodations: openAcc,
  };
}

export interface DashboardFilter {
  q?: string;
  status?: string;
  band?: string;
  includeArchived?: boolean;
}

export function dashboardRows(admin: Actor, f: DashboardFilter = {}): DashboardRow[] {
  requireAdmin(admin);
  const d = db();
  const rows: DashboardRow[] = [];
  const attempts = d
    .prepare(`SELECT a.*, u.full_name, u.email, u.location FROM attempts a JOIN users u ON u.id = a.candidate_id ORDER BY a.started_at DESC LIMIT 1000`)
    .all() as (AttemptRow & { full_name: string; email: string; location: string | null })[];
  for (const a of attempts) rows.push(rowForAttempt(a, { id: a.candidate_id, full_name: a.full_name, email: a.email, location: a.location }));

  // Invitations without an attempt yet.
  const pending = d
    .prepare(
      `SELECT i.id, i.email, i.full_name, i.candidate_id, i.created_at, u.location FROM invitations i LEFT JOIN users u ON u.id = i.candidate_id
       WHERE i.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.invitation_id = i.id) ORDER BY i.created_at DESC LIMIT 1000`,
    )
    .all() as { id: string; email: string; full_name: string; candidate_id: string | null; created_at: string; location: string | null }[];
  for (const p of pending) {
    rows.push({
      candidate_id: p.candidate_id ?? "",
      full_name: p.full_name,
      email: p.email,
      location: p.location,
      invitation_id: p.id,
      attempt_id: null,
      status: "invited",
      answered: 0,
      total: currentTemplate().questions.length,
      elapsed_seconds: null,
      active_seconds: null,
      started_at: null,
      submitted_at: null,
      score: null,
      score_is_final: false,
      scored: 0,
      band: null,
      integrity_events: 0,
      open_accommodations: 0,
    });
  }

  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (!f.includeArchived && r.status === "archived" && f.status !== "archived") return false;
    if (q && !r.full_name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
    if (f.status && f.status !== "all" && r.status !== f.status) return false;
    if (f.band && f.band !== "all") {
      if (f.band === "unscored") return r.score === null;
      if (f.band === "provisional") return r.score !== null && !r.score_is_final;
      if (r.band !== f.band) return false;
    }
    return true;
  });
}

export function candidateDetail(admin: Actor, candidateId: string) {
  requireAdmin(admin);
  const d = db();
  const user = d.prepare("SELECT id, email, full_name, phone, location, role, created_at FROM users WHERE id = ? AND role = 'candidate'").get(candidateId) as
    | { id: string; email: string; full_name: string; phone: string | null; location: string | null; role: string; created_at: string }
    | undefined;
  if (!user) throw new HttpError(404, "not_found", "Not found");
  const attempts = d.prepare("SELECT * FROM attempts WHERE candidate_id = ? ORDER BY started_at DESC").all(candidateId) as AttemptRow[];
  const invitations = d.prepare("SELECT id, email, created_at, accepted_at, revoked_at, expires_at FROM invitations WHERE candidate_id = ? OR email = ? ORDER BY created_at DESC").all(candidateId, user.email) as {
    id: string;
    email: string;
    created_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    expires_at: string;
  }[];
  audit(admin, "view_candidate", "candidate", candidateId);
  return { user, attempts: attempts.map((a) => rowForAttempt(a, user)), invitations };
}

export function attemptDetail(admin: Actor, attemptId: string) {
  const a = adminAttempt(admin, attemptId);
  const snap = snapshotOf(a);
  const user = db().prepare("SELECT id, email, full_name, phone, location, created_at FROM users WHERE id = ?").get(a.candidate_id) as {
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    location: string | null;
    created_at: string;
  };
  const answers = answersFor(a.id);
  const recs = liveRecordings(a.id);
  const reviews = reviewsFor(a.id);
  const score = scoreForAttempt(a);
  const events = eventsFor(a.id).map((e) => ({ ...e, metadata: parseJson<Record<string, unknown>>(e.metadata, {}) }));
  audit(admin, "view_attempt", "attempt", a.id);
  const byCode = new Map<string, AnswerRow>(answers.map((x) => [x.question_code, x]));
  return {
    attempt: a,
    elapsed_seconds: elapsedSeconds(a),
    snapshot: snap,
    candidate: user,
    score,
    band: band(score.final),
    questions: snap.questions.map((q) => {
      const ans = byCode.get(q.code)!;
      const rec = recs.filter((r) => r.answer_id === ans.id).at(-1) ?? null;
      const qReviews = reviews.filter((r) => r.question_code === q.code);
      return {
        question: q,
        answer: ans,
        answered: isAnswered(ans, recs),
        recording: rec
          ? {
              id: rec.id,
              mime_type: rec.mime_type,
              bytes: rec.bytes,
              duration_seconds: rec.duration_seconds,
              created_at: rec.created_at,
              transcription_status: rec.transcription_status,
              transcription_error: rec.transcription_error,
              play_url: signedMediaUrl(rec.id, admin.id),
              download_url: signedMediaUrl(rec.id, admin.id, { download: true }),
            }
          : null,
        myReview: qReviews.find((r) => r.reviewer_id === admin.id) ?? null,
        otherReviews: qReviews.filter((r) => r.reviewer_id !== admin.id),
        events: events.filter((e) => e.question_code === q.code && INTEGRITY_EVENT_TYPES.includes(e.event_type)).length,
      };
    }),
    events,
    accommodations: accommodationsFor(a.id),
    reviewers: [...new Set(reviews.map((r) => r.reviewer_name))],
  };
}

// ---------- compare ----------
export function compareAttempts(admin: Actor, attemptIds: string[]) {
  requireAdmin(admin);
  const ids = [...new Set(attemptIds)].slice(0, 6);
  const out = ids.map((aid) => {
    const a = adminAttempt(admin, aid);
    const snap = snapshotOf(a);
    const user = db().prepare("SELECT full_name, email FROM users WHERE id = ?").get(a.candidate_id) as { full_name: string; email: string };
    const s = scoreForAttempt(a);
    const qs = new Map(
      summarizeQuestions(a).map((x) => [x.code, x.score]),
    );
    return { attempt_id: a.id, status: a.status, candidate: user, score: s, band: band(s.final), elapsed_seconds: elapsedSeconds(a), active_seconds: a.total_active_seconds, questions: snap.questions.map((q) => ({ code: q.code, score: qs.get(q.code) ?? null })) };
  });
  audit(admin, "compare_attempts", "attempt", null, { ids });
  return out;
}

function summarizeQuestions(a: AttemptRow) {
  const reviews = reviewsFor(a.id).filter((r) => r.score !== null);
  const by = new Map<string, number[]>();
  for (const r of reviews) by.set(r.question_code, [...(by.get(r.question_code) ?? []), r.score as number]);
  return [...by.entries()].map(([code, xs]) => ({ code, score: Math.round((xs.reduce((p, c) => p + c, 0) / xs.length) * 10) / 10 }));
}

// ---------- CSV export ----------
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(admin: Actor, f: DashboardFilter, detail: "summary" | "answers" = "summary"): string {
  const rows = dashboardRows(admin, f);
  audit(admin, "export_csv", "attempt", null, { filter: f, detail, rows: rows.length });
  const bom = "﻿"; // Excel opens UTF-8 Chinese correctly with a BOM
  if (detail === "summary") {
    const head = ["candidate", "email", "status", "answered", "total", "elapsed_seconds", "active_seconds", "started_at", "submitted_at", "score", "score_final", "scored_questions", "band", "A", "B", "C", "D", "E", "integrity_events"];
    const lines = [head.join(",")];
    for (const r of rows) {
      const cats: Record<string, number | null> = {};
      if (r.attempt_id) for (const c of scoreForAttempt(adminAttempt(admin, r.attempt_id)).categories) cats[c.code] = c.points;
      lines.push(
        [r.full_name, r.email, r.status, r.answered, r.total, r.elapsed_seconds, r.active_seconds, r.started_at, r.submitted_at, r.score, r.score_is_final ? "yes" : "no", r.scored, r.band, cats.A, cats.B, cats.C, cats.D, cats.E, r.integrity_events]
          .map(csvCell)
          .join(","),
      );
    }
    return bom + lines.join("\r\n");
  }
  const head = ["candidate", "email", "attempt_id", "question", "category", "typed_text", "machine_transcript", "corrected_transcript", "active_seconds", "recording_seconds", "avg_score", "reviewer_count"];
  const lines = [head.join(",")];
  for (const r of rows) {
    if (!r.attempt_id) continue;
    const a = adminAttempt(admin, r.attempt_id);
    const snap = snapshotOf(a);
    const ans = new Map(answersFor(a.id).map((x) => [x.question_code, x]));
    const reviews = reviewsFor(a.id).filter((x) => x.score !== null);
    for (const q of snap.questions) {
      const x = ans.get(q.code)!;
      const rs = reviews.filter((y) => y.question_code === q.code).map((y) => y.score as number);
      lines.push(
        [r.full_name, r.email, a.id, q.code, q.category, x.typed_text, x.machine_transcript, x.corrected_transcript, x.active_duration_seconds, x.recording_duration_seconds, rs.length ? (rs.reduce((p, c) => p + c, 0) / rs.length).toFixed(2) : "", rs.length]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return bom + lines.join("\r\n");
}

// ---------- admin accounts & audit ----------
export function listAdmins(admin: Actor) {
  requireAdmin(admin);
  return db().prepare("SELECT id, email, full_name, role, created_at, disabled_at FROM users WHERE role IN ('admin','super_admin') ORDER BY created_at").all() as {
    id: string;
    email: string;
    full_name: string;
    role: string;
    created_at: string;
    disabled_at: string | null;
  }[];
}

export function auditLog(admin: Actor, limit = 200) {
  requireAdmin(admin);
  return db()
    .prepare(`SELECT l.*, u.full_name AS admin_name FROM admin_audit_logs l JOIN users u ON u.id = l.admin_id ORDER BY l.occurred_at DESC LIMIT ?`)
    .all(limit) as { id: string; action: string; target_type: string; target_id: string | null; metadata: string; occurred_at: string; admin_name: string }[];
}

/**
 * Permanently delete a candidate: their attempts, answers, recordings (files too), reviews, events and
 * invitations. Audited. Admin accounts can't be deleted this way.
 */
export function deleteCandidate(admin: Actor, candidateId: string): { attempts: number; recordings: number } {
  requireAdmin(admin);
  const d = db();
  const user = d.prepare("SELECT id, email, role FROM users WHERE id = ?").get(candidateId) as { id: string; email: string; role: string } | undefined;
  if (!user || user.role !== "candidate") throw new HttpError(404, "not_found", "Not found");
  const attempts = d.prepare("SELECT id FROM attempts WHERE candidate_id = ?").all(candidateId) as { id: string }[];
  const recs = d.prepare(`SELECT storage_path FROM recordings WHERE attempt_id IN (SELECT id FROM attempts WHERE candidate_id = ?)`).all(candidateId) as { storage_path: string }[];
  const root = path.resolve(config.storageDir);
  for (const a of attempts) {
    const dir = path.resolve(root, a.id);
    if (dir.startsWith(root + path.sep)) fs.rmSync(dir, { recursive: true, force: true });
  }
  d.transaction(() => {
    d.prepare("DELETE FROM attempts WHERE candidate_id = ?").run(candidateId); // cascades answers, recordings, reviews, events, requests
    d.prepare("DELETE FROM invitations WHERE candidate_id = ? OR email = ?").run(candidateId, user.email);
    d.prepare("DELETE FROM users WHERE id = ?").run(candidateId); // cascades sessions, login links
  })();
  audit(admin, "delete_candidate", "candidate", candidateId, { attempts: attempts.length, recordings: recs.length });
  return { attempts: attempts.length, recordings: recs.length };
}
