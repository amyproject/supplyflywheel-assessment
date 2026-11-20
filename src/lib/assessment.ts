import "server-only";
import crypto from "node:crypto";
import { db, id, now, parseJson, sha256, DEFAULT_TEMPLATE_SLUG, rateLimit, getSetting, appSecret } from "@/lib/db";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/http";
import { type Actor, createUser, findUserByEmail, isAdmin, normalizeEmail } from "@/lib/auth";
import type { Category } from "@/lib/questions";

// ---------- types ----------
export interface TemplateQuestion {
  code: string;
  category: string;
  order: number;
  prompt_zh: string;
  prompt_en: string;
  rubric_zh: string;
  rubric_en: string;
  weight: number;
  soft_limit_seconds: number;
  hard_limit_seconds: number | null;
}

export interface TemplateSnapshot {
  id: string;
  slug: string;
  title: string;
  version: number;
  scenario: {
    title_zh: string;
    title_en: string;
    body_zh: string;
    body_en: string;
    facts_zh: string[];
    facts_en: string[];
    note_zh: string;
    note_en: string;
  };
  categories: Category[];
  recommended_seconds: number;
  overall_limit_seconds: number | null;
  auto_submit_on_expiry: boolean;
  copy_restriction_enabled: boolean;
  paste_restriction_enabled: boolean;
  allow_navigation: boolean;
  questions: TemplateQuestion[];
}

export type AttemptStatus = "in_progress" | "submitted" | "expired" | "reopened";

export interface AttemptRow {
  id: string;
  candidate_id: string;
  template_id: string;
  invitation_id: string | null;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  last_active_at: string;
  deadline_at: string | null;
  extension_seconds: number;
  total_active_seconds: number;
  heartbeat_seq: number;
  heartbeat_at: string | null;
  current_question_code: string | null;
  consent_terms_at: string;
  consent_recording_at: string | null;
  paste_accommodation: number;
  template_snapshot: string;
  archived_at: string | null;
}

export interface AnswerRow {
  id: string;
  attempt_id: string;
  question_code: string;
  typed_text: string;
  machine_transcript: string | null;
  transcript_provider: string | null;
  corrected_transcript: string | null;
  first_opened_at: string | null;
  last_left_at: string | null;
  active_duration_seconds: number;
  recording_duration_seconds: number;
  rev: number;
  saved_at: string | null;
  submitted_at: string | null;
}

export interface RecordingRow {
  id: string;
  answer_id: string;
  attempt_id: string;
  storage_path: string;
  mime_type: string;
  bytes: number;
  duration_seconds: number;
  transcription_status: "none" | "queued" | "processing" | "done" | "failed" | "unavailable";
  transcription_error: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** Seconds of grace after the deadline for in-flight autosaves. */
const DEADLINE_GRACE_MS = 30_000;

// ---------- audit ----------
export function audit(admin: Actor, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  db()
    .prepare("INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, metadata, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id("aud"), admin.id, action, targetType, targetId, JSON.stringify(metadata), now());
}

export function logEvent(attemptId: string, eventType: string, questionCode: string | null = null, metadata: Record<string, unknown> = {}) {
  db()
    .prepare("INSERT INTO activity_events (id, attempt_id, question_code, event_type, metadata, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id("evt"), attemptId, questionCode, eventType, JSON.stringify(metadata), now());
}

// ---------- templates ----------
interface TemplateRow {
  id: string;
  slug: string;
  title: string;
  version: number;
  scenario_json: string;
  categories_json: string;
  recommended_seconds: number;
  overall_limit_seconds: number | null;
  auto_submit_on_expiry: number;
  copy_restriction_enabled: number;
  paste_restriction_enabled: number;
  allow_navigation: number;
  published_at: string | null;
  created_at: string;
}

export function loadTemplate(templateId: string): TemplateSnapshot {
  const d = db();
  const t = d.prepare("SELECT * FROM assessment_templates WHERE id = ?").get(templateId) as TemplateRow | undefined;
  if (!t) throw new HttpError(404, "not_found", "测评模板不存在 / Template not found");
  const qs = d.prepare("SELECT * FROM questions WHERE template_id = ? ORDER BY display_order").all(templateId) as {
    question_code: string;
    category: string;
    display_order: number;
    prompt_zh: string;
    prompt_en: string;
    rubric_zh: string;
    rubric_en: string;
    category_weight: number;
    soft_limit_seconds: number;
    hard_limit_seconds: number | null;
  }[];
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    version: t.version,
    scenario: parseJson(t.scenario_json, {} as TemplateSnapshot["scenario"]),
    categories: parseJson(t.categories_json, [] as Category[]),
    recommended_seconds: t.recommended_seconds,
    overall_limit_seconds: t.overall_limit_seconds,
    auto_submit_on_expiry: !!t.auto_submit_on_expiry,
    copy_restriction_enabled: !!t.copy_restriction_enabled,
    paste_restriction_enabled: !!t.paste_restriction_enabled,
    allow_navigation: !!t.allow_navigation,
    questions: qs.map((q) => ({
      code: q.question_code,
      category: q.category,
      order: q.display_order,
      prompt_zh: q.prompt_zh,
      prompt_en: q.prompt_en,
      rubric_zh: q.rubric_zh,
      rubric_en: q.rubric_en,
      weight: q.category_weight,
      soft_limit_seconds: q.soft_limit_seconds,
      hard_limit_seconds: q.hard_limit_seconds,
    })),
  };
}

export function currentTemplate(slug = DEFAULT_TEMPLATE_SLUG): TemplateSnapshot {
  const row = db()
    .prepare("SELECT id FROM assessment_templates WHERE slug = ? AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1")
    .get(slug) as { id: string } | undefined;
  if (!row) throw new HttpError(404, "not_found", "没有已发布的测评 / No published assessment");
  return loadTemplate(row.id);
}

export function listTemplateVersions(slug = DEFAULT_TEMPLATE_SLUG) {
  return db()
    .prepare(
      `SELECT t.id, t.version, t.published_at, t.created_at, u.full_name AS created_by_name,
         (SELECT COUNT(*) FROM attempts a WHERE a.template_id = t.id) AS attempts
       FROM assessment_templates t LEFT JOIN users u ON u.id = t.created_by WHERE t.slug = ? ORDER BY t.version DESC`,
    )
    .all(slug) as { id: string; version: number; published_at: string | null; created_at: string; created_by_name: string | null; attempts: number }[];
}

export interface TemplateSettingsInput {
  recommended_minutes: number;
  overall_limit_minutes: number | null;
  auto_submit_on_expiry: boolean;
  copy_restriction_enabled: boolean;
  paste_restriction_enabled: boolean;
  allow_navigation: boolean;
  soft_limit_minutes: number;
}

/** Settings edits publish a new template version; existing attempts keep their snapshot. */
export function publishTemplateSettings(admin: Actor, input: TemplateSettingsInput, slug = DEFAULT_TEMPLATE_SLUG): TemplateSnapshot {
  if (!isAdmin(admin)) throw new HttpError(403, "forbidden", "Forbidden");
  const cur = currentTemplate(slug);
  const d = db();
  const tid = id("tpl");
  const ts = now();
  d.transaction(() => {
    d.prepare(
      `INSERT INTO assessment_templates (id, slug, title, version, language, scenario_json, categories_json, recommended_seconds, overall_limit_seconds,
         auto_submit_on_expiry, copy_restriction_enabled, paste_restriction_enabled, allow_navigation, published_at, created_by, created_at)
       VALUES (?, ?, ?, ?, 'zh-CN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tid,
      slug,
      cur.title,
      cur.version + 1,
      JSON.stringify(cur.scenario),
      JSON.stringify(cur.categories),
      Math.round(input.recommended_minutes * 60),
      input.overall_limit_minutes === null ? null : Math.round(input.overall_limit_minutes * 60),
      input.auto_submit_on_expiry ? 1 : 0,
      input.copy_restriction_enabled ? 1 : 0,
      input.paste_restriction_enabled ? 1 : 0,
      input.allow_navigation ? 1 : 0,
      ts,
      admin.id,
      ts,
    );
    const ins = d.prepare(
      `INSERT INTO questions (id, template_id, question_code, category, display_order, prompt_zh, prompt_en, rubric_zh, rubric_en, category_weight, soft_limit_seconds, hard_limit_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const q of cur.questions) {
      ins.run(id("q"), tid, q.code, q.category, q.order, q.prompt_zh, q.prompt_en, q.rubric_zh, q.rubric_en, q.weight, Math.round(input.soft_limit_minutes * 60), q.hard_limit_seconds);
    }
  })();
  audit(admin, "publish_template", "template", tid, { version: cur.version + 1, ...input });
  return loadTemplate(tid);
}

// ---------- invitations ----------
export interface InvitationRow {
  id: string;
  email: string;
  full_name: string;
  template_id: string;
  expires_at: string;
  accepted_at: string | null;
  candidate_id: string | null;
  revoked_at: string | null;
  last_sent_at: string | null;
  created_by: string;
  created_at: string;
}

export function inviteUrl(token: string) {
  return `${config.appBaseUrl}/invite/${token}`;
}

export function createInvitation(admin: Actor, input: { email: string; full_name: string }): { invitation: InvitationRow; token: string; url: string } {
  if (!isAdmin(admin)) throw new HttpError(403, "forbidden", "Forbidden");
  const email = normalizeEmail(input.email);
  const existing = findUserByEmail(email);
  if (existing && existing.role !== "candidate") throw new HttpError(409, "conflict", "该邮箱属于管理员账户 / That email belongs to an admin account");
  const tpl = currentTemplate();
  const token = crypto.randomBytes(24).toString("base64url");
  const invId = id("inv");
  const ts = now();
  db()
    .prepare(
      "INSERT INTO invitations (id, email, full_name, template_id, token_hash, expires_at, candidate_id, created_by, created_at, last_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(invId, email, input.full_name.trim(), tpl.id, sha256(token), new Date(Date.now() + config.invitationDays * 864e5).toISOString(), null, admin.id, ts, ts);
  audit(admin, "create_invitation", "invitation", invId, { email });
  return { invitation: getInvitation(invId)!, token, url: inviteUrl(token) };
}

/** Rotates the token (the old link stops working) and extends expiry. */
export function reissueInvitation(admin: Actor, invitationId: string): { token: string; url: string; invitation: InvitationRow } {
  if (!isAdmin(admin)) throw new HttpError(403, "forbidden", "Forbidden");
  const inv = getInvitation(invitationId);
  if (!inv) throw new HttpError(404, "not_found", "Not found");
  if (inv.accepted_at) throw new HttpError(409, "conflict", "邀请已被接受 / Invitation already accepted");
  const token = crypto.randomBytes(24).toString("base64url");
  db()
    .prepare("UPDATE invitations SET token_hash = ?, expires_at = ?, revoked_at = NULL, last_sent_at = ? WHERE id = ?")
    .run(sha256(token), new Date(Date.now() + config.invitationDays * 864e5).toISOString(), now(), invitationId);
  audit(admin, "reissue_invitation", "invitation", invitationId);
  return { token, url: inviteUrl(token), invitation: getInvitation(invitationId)! };
}

export function revokeInvitation(admin: Actor, invitationId: string) {
  if (!isAdmin(admin)) throw new HttpError(403, "forbidden", "Forbidden");
  const res = db().prepare("UPDATE invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL").run(now(), invitationId);
  if (res.changes !== 1) throw new HttpError(409, "conflict", "无法撤销 / Cannot revoke");
  audit(admin, "revoke_invitation", "invitation", invitationId);
}

export function getInvitation(invitationId: string): InvitationRow | undefined {
  return db().prepare("SELECT * FROM invitations WHERE id = ?").get(invitationId) as InvitationRow | undefined;
}

export function listInvitations(): (InvitationRow & { candidate_name: string | null })[] {
  return db()
    .prepare("SELECT i.*, u.full_name AS candidate_name FROM invitations i LEFT JOIN users u ON u.id = i.candidate_id ORDER BY i.created_at DESC LIMIT 500")
    .all() as (InvitationRow & { candidate_name: string | null })[];
}

export type InvitationState = "valid" | "expired" | "revoked" | "accepted" | "invalid";

export function invitationByToken(token: string): { invitation: InvitationRow | null; state: InvitationState } {
  if (!token || token.length > 200) return { invitation: null, state: "invalid" };
  const inv = db().prepare("SELECT * FROM invitations WHERE token_hash = ?").get(sha256(token)) as InvitationRow | undefined;
  if (!inv) return { invitation: null, state: "invalid" };
  if (inv.revoked_at) return { invitation: inv, state: "revoked" };
  if (inv.accepted_at) return { invitation: inv, state: "accepted" };
  if (inv.expires_at < now()) return { invitation: inv, state: "expired" };
  return { invitation: inv, state: "valid" };
}

/**
 * Accept an invitation. Either the signed-in candidate whose email matches,
 * or a brand-new account (no existing user with that email).
 */
export function acceptInvitation(
  token: string,
  opts: { actor: Actor | null; password?: string; full_name?: string; phone?: string | null; location?: string | null },
): Actor {
  const { invitation, state } = invitationByToken(token);
  if (!invitation || state !== "valid") throw new HttpError(410, "invitation_" + state, "邀请链接无效或已过期 / This invitation link is invalid or expired");
  const d = db();
  let candidate: Actor;
  if (opts.actor) {
    if (opts.actor.role !== "candidate") throw new HttpError(403, "forbidden", "管理员账户不能接受候选人邀请 / Admin accounts cannot accept candidate invitations");
    if (normalizeEmail(opts.actor.email) !== invitation.email) throw new HttpError(403, "email_mismatch", "此邀请属于其他邮箱 / This invitation belongs to a different email");
    candidate = opts.actor;
  } else {
    if (findUserByEmail(invitation.email)) throw new HttpError(409, "account_exists", "该邮箱已有账户，请先登录 / An account exists for this email; sign in first");
    if (!opts.password || opts.password.length < 10) throw new HttpError(400, "weak_password", "密码至少10位 / Password must be at least 10 characters");
    candidate = createUser({
      email: invitation.email,
      full_name: opts.full_name?.trim() || invitation.full_name,
      password: opts.password,
      role: "candidate",
      phone: opts.phone,
      location: opts.location,
    });
  }
  const res = d.prepare("UPDATE invitations SET accepted_at = ?, candidate_id = ? WHERE id = ? AND accepted_at IS NULL").run(now(), candidate.id, invitation.id);
  if (res.changes !== 1) throw new HttpError(409, "conflict", "邀请已被接受 / Invitation already accepted");
  return candidate;
}

/** The candidate's accepted, unrevoked invitations, with any attempt started for each. */
export function candidateAssignments(candidateId: string) {
  return db()
    .prepare(
      `SELECT i.id AS invitation_id, i.template_id, i.accepted_at, t.title, t.version, t.recommended_seconds, t.overall_limit_seconds,
         a.id AS attempt_id, a.status AS attempt_status, a.started_at, a.submitted_at
       FROM invitations i JOIN assessment_templates t ON t.id = i.template_id
       LEFT JOIN attempts a ON a.invitation_id = i.id
       WHERE i.candidate_id = ? AND i.revoked_at IS NULL ORDER BY i.accepted_at DESC`,
    )
    .all(candidateId) as {
    invitation_id: string;
    template_id: string;
    accepted_at: string;
    title: string;
    version: number;
    recommended_seconds: number;
    overall_limit_seconds: number | null;
    attempt_id: string | null;
    attempt_status: AttemptStatus | null;
    started_at: string | null;
    submitted_at: string | null;
  }[];
}

export function updateCandidateProfile(actor: Actor, input: { full_name: string; phone: string | null; location: string | null }) {
  db().prepare("UPDATE users SET full_name = ?, phone = ?, location = ? WHERE id = ?").run(input.full_name.trim(), input.phone?.trim() || null, input.location?.trim() || null, actor.id);
}

// ---------- attempts (candidate side) ----------
function getAttemptRow(attemptId: string): AttemptRow | undefined {
  return db().prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as AttemptRow | undefined;
}

export function snapshotOf(attempt: AttemptRow): TemplateSnapshot {
  return parseJson(attempt.template_snapshot, {} as TemplateSnapshot);
}

/**
 * Object-level authorization: a candidate can only see their own attempt.
 * Unknown and foreign IDs both return 404 so IDs can't be probed.
 */
export function ownAttempt(actor: Actor, attemptId: string): AttemptRow {
  const a = getAttemptRow(attemptId);
  if (!a || a.candidate_id !== actor.id || a.archived_at) throw new HttpError(404, "not_found", "未找到 / Not found");
  return refreshExpiry(a);
}

/** Apply deadline rules lazily: expire, or auto-submit if the template says so. */
export function refreshExpiry(a: AttemptRow): AttemptRow {
  if ((a.status !== "in_progress" && a.status !== "reopened") || !a.deadline_at) return a;
  const deadline = Date.parse(a.deadline_at);
  if (Date.now() < deadline + DEADLINE_GRACE_MS) return a;
  const snap = snapshotOf(a);
  const d = db();
  if (snap.auto_submit_on_expiry) {
    finalize(a.id, a.deadline_at, "auto_submit_on_expiry");
  } else {
    d.prepare("UPDATE attempts SET status = 'expired' WHERE id = ? AND status IN ('in_progress','reopened')").run(a.id);
    logEvent(a.id, "expired");
  }
  return getAttemptRow(a.id)!;
}

export function isEditable(a: AttemptRow): boolean {
  return a.status === "in_progress" || a.status === "reopened";
}

export function startAttempt(actor: Actor, input: { invitation_id: string; consent_terms: boolean; consent_recording: boolean }): AttemptRow {
  if (actor.role !== "candidate") throw new HttpError(403, "forbidden", "仅候选人可开始测评 / Only candidates can start");
  if (!input.consent_terms) throw new HttpError(400, "consent_required", "请先阅读并同意测评说明与隐私声明 / Please accept the instructions and privacy notice");
  const d = db();
  const inv = d.prepare("SELECT * FROM invitations WHERE id = ? AND candidate_id = ? AND revoked_at IS NULL").get(input.invitation_id, actor.id) as InvitationRow | undefined;
  if (!inv) throw new HttpError(404, "not_found", "未找到邀请 / Invitation not found");
  const existing = d.prepare("SELECT * FROM attempts WHERE invitation_id = ?").get(inv.id) as AttemptRow | undefined;
  if (existing) {
    // Idempotent: starting again returns the same attempt (and lets the candidate grant recording consent later).
    if (input.consent_recording && !existing.consent_recording_at && isEditable(existing)) {
      d.prepare("UPDATE attempts SET consent_recording_at = ? WHERE id = ?").run(now(), existing.id);
      logEvent(existing.id, "consent_recording");
    }
    return getAttemptRow(existing.id)!;
  }
  return createAttempt(actor.id, inv.template_id, inv.id, input.consent_recording);
}

/** Creates the attempt row, the 20 answer rows and the server start timestamp. */
function createAttempt(candidateId: string, templateId: string, invitationId: string | null, consentRecording: boolean): AttemptRow {
  const d = db();
  const snap = loadTemplate(templateId);
  const aid = id("att");
  const started = new Date();
  const ts = started.toISOString();
  const deadline = snap.overall_limit_seconds ? new Date(started.getTime() + snap.overall_limit_seconds * 1000).toISOString() : null;
  d.transaction(() => {
    d.prepare(
      `INSERT INTO attempts (id, candidate_id, template_id, invitation_id, status, started_at, last_active_at, deadline_at, consent_terms_at, consent_recording_at, template_snapshot, current_question_code)
       VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(aid, candidateId, snap.id, invitationId, ts, ts, deadline, ts, consentRecording ? ts : null, JSON.stringify(snap), snap.questions[0]?.code ?? null);
    const ins = d.prepare("INSERT INTO answers (id, attempt_id, question_code) VALUES (?, ?, ?)");
    for (const q of snap.questions) ins.run(id("ans"), aid, q.code);
  })();
  logEvent(aid, "started", null, { template_version: snap.version, public: invitationId === null });
  if (consentRecording) logEvent(aid, "consent_recording");
  return getAttemptRow(aid)!;
}

// ---------- public (no-login) test taking ----------
export interface PublicStartInput {
  full_name: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  access_code?: string | null;
  consent_terms: boolean;
  consent_recording: boolean;
}

export function accessCodeRequired(): boolean {
  return getSetting("access_code", "").trim() !== "";
}

function accessCodeMatches(given: string | null | undefined): boolean {
  const want = getSetting("access_code", "").trim();
  if (!want) return true;
  const a = Buffer.from(sha256((given ?? "").trim()));
  const b = Buffer.from(sha256(want));
  return crypto.timingSafeEqual(a, b);
}

/**
 * Starts a test without a password. A lightweight candidate account is created behind the scenes and the
 * browser gets a normal session cookie, so every ownership check stays the same. An email that already has
 * an attempt can't be "claimed" by typing it again (that would expose someone else's answers); the
 * candidate uses their private resume link instead.
 */
export function startPublicAttempt(input: PublicStartInput): { candidate: Actor; attempt: AttemptRow } {
  if (!input.consent_terms) throw new HttpError(400, "consent_required", "请先阅读并同意测评说明与隐私声明 / Please accept the instructions and privacy notice");
  if (!accessCodeMatches(input.access_code)) throw new HttpError(403, "bad_access_code", "测评口令不正确 / Incorrect access code");
  const name = input.full_name.trim();
  if (!name) throw new HttpError(400, "name_required", "请填写姓名 / Name is required");
  const email = normalizeEmail(input.email);
  const existing = findUserByEmail(email);
  let candidate: Actor;
  if (existing) {
    if (existing.role !== "candidate") throw new HttpError(409, "conflict", "该邮箱不能用于参加测评 / This email can't be used for the test");
    const prior = db().prepare("SELECT status FROM attempts WHERE candidate_id = ? ORDER BY started_at DESC LIMIT 1").get(existing.id) as { status: AttemptStatus } | undefined;
    if (prior?.status === "submitted") throw new HttpError(409, "already_submitted", "该邮箱已提交过测评，如需重考请联系招聘方 / This email has already submitted; contact the recruiter to retake");
    if (prior) throw new HttpError(409, "in_progress_elsewhere", "该邮箱已有进行中的测评，请使用开始时获得的续答链接继续 / This email already has a test in progress; use your private resume link to continue");
    candidate = existing;
    db().prepare("UPDATE users SET full_name = ?, phone = COALESCE(?, phone), location = COALESCE(?, location) WHERE id = ?").run(name, input.phone?.trim() || null, input.location?.trim() || null, existing.id);
  } else {
    candidate = createUser({ email, full_name: name, role: "candidate", phone: input.phone, location: input.location });
  }
  const attempt = createAttempt(candidate.id, currentTemplate().id, null, input.consent_recording);
  return { candidate: getUserFresh(candidate.id), attempt };
}

function getUserFresh(uid: string): Actor {
  return db().prepare("SELECT id, email, full_name, phone, location, role, created_at FROM users WHERE id = ?").get(uid) as Actor;
}

/** Private, deterministic resume link token for an attempt (HMAC; nothing extra to store). */
export function resumeToken(attemptId: string): string {
  const mac = crypto.createHmac("sha256", appSecret()).update(`resume|${attemptId}`).digest("base64url").slice(0, 32);
  return `${attemptId}.${mac}`;
}

export function resumeUrl(attemptId: string): string {
  return `${config.appBaseUrl}/resume/${resumeToken(attemptId)}`;
}

/** Returns the attempt for a valid resume token, else null. */
export function attemptFromResumeToken(token: string): AttemptRow | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1 || token.length > 120) return null;
  const aid = token.slice(0, dot);
  const expected = Buffer.from(resumeToken(aid));
  const got = Buffer.from(token);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
  const a = getAttemptRow(aid);
  return a && !a.archived_at ? a : null;
}

/** The candidate's attempts, newest first (their home page). */
export function candidateAttempts(candidateId: string) {
  return (db().prepare("SELECT * FROM attempts WHERE candidate_id = ? AND archived_at IS NULL ORDER BY started_at DESC").all(candidateId) as AttemptRow[]).map(refreshExpiry);
}

/** Candidate grants recording consent after starting (separate from the general terms). */
export function grantRecordingConsent(actor: Actor, attemptId: string) {
  const a = ownAttempt(actor, attemptId);
  if (!isEditable(a)) throw new HttpError(409, "locked", "答案已锁定 / Answers are locked");
  if (!a.consent_recording_at) {
    db().prepare("UPDATE attempts SET consent_recording_at = ? WHERE id = ?").run(now(), a.id);
    logEvent(a.id, "consent_recording");
  }
}

export function answersFor(attemptId: string): AnswerRow[] {
  return db().prepare("SELECT * FROM answers WHERE attempt_id = ?").all(attemptId) as AnswerRow[];
}

export function liveRecordings(attemptId: string): RecordingRow[] {
  return db().prepare("SELECT * FROM recordings WHERE attempt_id = ? AND deleted_at IS NULL ORDER BY created_at").all(attemptId) as RecordingRow[];
}

export function isAnswered(ans: AnswerRow, recs: RecordingRow[]): boolean {
  return Boolean(ans.typed_text.trim() || ans.corrected_transcript?.trim() || recs.some((r) => r.answer_id === ans.id));
}

/** Everything the candidate UI needs; never includes rubrics or scores. */
export function candidateView(actor: Actor, attemptId: string) {
  const a = ownAttempt(actor, attemptId);
  const snap = snapshotOf(a);
  const answers = answersFor(a.id);
  const recs = liveRecordings(a.id);
  return {
    attempt: {
      id: a.id,
      status: a.status,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      deadline_at: a.deadline_at,
      total_active_seconds: a.total_active_seconds,
      current_question_code: a.current_question_code,
      heartbeat_seq: a.heartbeat_seq,
      recording_consent: !!a.consent_recording_at,
      paste_allowed: !snap.paste_restriction_enabled || !!a.paste_accommodation,
      editable: isEditable(a),
      resume_url: resumeUrl(a.id),
    },
    settings: {
      title: snap.title,
      version: snap.version,
      recommended_seconds: snap.recommended_seconds,
      overall_limit_seconds: snap.overall_limit_seconds,
      auto_submit_on_expiry: snap.auto_submit_on_expiry,
      copy_restriction_enabled: snap.copy_restriction_enabled,
      paste_restriction_enabled: snap.paste_restriction_enabled,
      allow_navigation: snap.allow_navigation,
    },
    scenario: snap.scenario,
    categories: snap.categories.map((c) => ({ code: c.code, name_zh: c.name_zh, name_en: c.name_en })),
    questions: snap.questions.map((q) => ({ code: q.code, category: q.category, order: q.order, prompt_zh: q.prompt_zh, prompt_en: q.prompt_en, soft_limit_seconds: q.soft_limit_seconds })),
    answers: answers.map((ans) => {
      const rec = recs.filter((r) => r.answer_id === ans.id).at(-1);
      return {
        question_code: ans.question_code,
        typed_text: ans.typed_text,
        machine_transcript: ans.machine_transcript,
        corrected_transcript: ans.corrected_transcript,
        active_duration_seconds: ans.active_duration_seconds,
        rev: ans.rev,
        saved_at: ans.saved_at,
        answered: isAnswered(ans, recs),
        recording: rec
          ? { id: rec.id, duration_seconds: rec.duration_seconds, mime_type: rec.mime_type, transcription_status: rec.transcription_status, transcription_error: rec.transcription_error }
          : null,
      };
    }),
    server_now: now(),
  };
}

export interface SaveInput {
  rev?: number;
  typed_text?: string;
  corrected_transcript?: string | null;
  seq?: number;
  active_delta?: number;
  opened?: boolean;
  left?: boolean;
}

const MAX_TEXT = 20_000;

/**
 * Idempotent autosave. Text applies only when `rev` is newer than what's stored
 * (so a retried or out-of-order request can't overwrite newer text). Active time
 * applies only for a new heartbeat `seq`, clamped to wall-clock time since the last heartbeat.
 */
export function saveAnswer(actor: Actor, attemptId: string, questionCode: string, input: SaveInput) {
  const a = ownAttempt(actor, attemptId);
  if (!isEditable(a)) throw new HttpError(409, "locked", "答案已锁定 / Answers are locked");
  const d = db();
  const ans = d.prepare("SELECT * FROM answers WHERE attempt_id = ? AND question_code = ?").get(a.id, questionCode) as AnswerRow | undefined;
  if (!ans) throw new HttpError(404, "not_found", "题目不存在 / Question not found");
  if (input.typed_text !== undefined && input.typed_text.length > MAX_TEXT) throw new HttpError(413, "too_long", "回答过长 / Answer too long");
  if (input.corrected_transcript && input.corrected_transcript.length > MAX_TEXT) throw new HttpError(413, "too_long", "转写过长 / Transcript too long");

  const ts = now();
  d.transaction(() => {
    if (input.rev !== undefined && input.rev > ans.rev && (input.typed_text !== undefined || input.corrected_transcript !== undefined)) {
      d.prepare(
        `UPDATE answers SET typed_text = COALESCE(?, typed_text), corrected_transcript = CASE WHEN ? THEN ? ELSE corrected_transcript END, rev = ?, saved_at = ? WHERE id = ?`,
      ).run(input.typed_text ?? null, input.corrected_transcript !== undefined ? 1 : 0, input.corrected_transcript ?? null, input.rev, ts, ans.id);
    }
    if (input.seq !== undefined && input.seq > a.heartbeat_seq) {
      const sinceLast = a.heartbeat_at ? (Date.now() - Date.parse(a.heartbeat_at)) / 1000 + 5 : 30;
      const delta = Math.max(0, Math.min(Math.floor(input.active_delta ?? 0), Math.floor(sinceLast), 120));
      d.prepare("UPDATE answers SET active_duration_seconds = active_duration_seconds + ? WHERE id = ?").run(delta, ans.id);
      d.prepare("UPDATE attempts SET total_active_seconds = total_active_seconds + ?, heartbeat_seq = ?, heartbeat_at = ? WHERE id = ?").run(delta, input.seq, ts, a.id);
    }
    if (input.opened) {
      d.prepare("UPDATE answers SET first_opened_at = COALESCE(first_opened_at, ?) WHERE id = ?").run(ts, ans.id);
      d.prepare("UPDATE attempts SET current_question_code = ? WHERE id = ?").run(questionCode, a.id);
    }
    if (input.left) d.prepare("UPDATE answers SET last_left_at = ? WHERE id = ?").run(ts, ans.id);
    d.prepare("UPDATE attempts SET last_active_at = ? WHERE id = ?").run(ts, a.id);
  })();
  if (input.opened) logEvent(a.id, "question_open", questionCode);
  if (input.left) logEvent(a.id, "question_leave", questionCode);
  const after = d.prepare("SELECT rev, saved_at, active_duration_seconds FROM answers WHERE id = ?").get(ans.id) as Pick<AnswerRow, "rev" | "saved_at" | "active_duration_seconds">;
  const att = getAttemptRow(a.id)!;
  return { ...after, heartbeat_seq: att.heartbeat_seq, total_active_seconds: att.total_active_seconds, server_now: ts };
}

export const CLIENT_EVENT_TYPES = new Set([
  "visibility_hidden",
  "visibility_visible",
  "copy_blocked",
  "cut_blocked",
  "contextmenu_blocked",
  "paste_blocked",
  "drop_blocked",
  "recording_started",
  "recording_stopped",
  "recording_error",
  "mic_denied",
  "mic_unsupported",
  "offline",
  "online",
]);

/** Integrity/activity events from the client. Minimal data; never used to auto-reject. */
export function recordClientEvents(actor: Actor, attemptId: string, events: { type: string; question_code?: string | null; meta?: Record<string, unknown> }[]) {
  const a = ownAttempt(actor, attemptId);
  if (!rateLimit(`evt:${a.id}`, 240, 600)) return { accepted: 0 };
  let accepted = 0;
  for (const e of events.slice(0, 20)) {
    if (!CLIENT_EVENT_TYPES.has(e.type)) continue;
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.meta ?? {}).slice(0, 4)) {
      if (typeof v === "number" || typeof v === "boolean") meta[k] = v;
      else if (typeof v === "string") meta[k] = v.slice(0, 80);
    }
    logEvent(a.id, e.type, e.question_code ?? null, meta);
    accepted++;
  }
  return { accepted };
}

function finalize(attemptId: string, submittedAt: string, reason: string) {
  const d = db();
  d.transaction(() => {
    const res = d.prepare("UPDATE attempts SET status = 'submitted', submitted_at = ? WHERE id = ? AND status != 'submitted'").run(submittedAt, attemptId);
    if (res.changes === 1) {
      d.prepare("UPDATE answers SET submitted_at = ? WHERE attempt_id = ?").run(submittedAt, attemptId);
      logEvent(attemptId, "submitted", null, { reason });
    }
  })();
}

/** Idempotent submit. Allowed while in progress, reopened, or expired (drafts were saved; editing is not). */
export function submitAttempt(actor: Actor, attemptId: string) {
  const a = ownAttempt(actor, attemptId);
  if (a.status !== "submitted") finalize(a.id, now(), a.status === "expired" ? "after_deadline" : "candidate");
  const after = getAttemptRow(a.id)!;
  return { id: after.id, status: after.status, submitted_at: after.submitted_at, receipt: receiptCode(after.id) };
}

export function receiptCode(attemptId: string) {
  return sha256(attemptId).slice(0, 10).toUpperCase();
}

export function requestAccommodation(actor: Actor, attemptId: string, kind: string, message: string) {
  const a = ownAttempt(actor, attemptId);
  if (!rateLimit(`acc:${a.id}`, 5, 3600)) throw new HttpError(429, "rate_limited", "请求过于频繁 / Too many requests");
  const k = ["paste", "time", "other"].includes(kind) ? kind : "other";
  db()
    .prepare("INSERT INTO accommodation_requests (id, attempt_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id("acc"), a.id, k, message.slice(0, 1000), now());
  logEvent(a.id, "accommodation_requested", null, { kind: k });
}

// ---------- admin side ----------
function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new HttpError(403, "forbidden", "Forbidden");
}

export function adminAttempt(admin: Actor, attemptId: string): AttemptRow {
  requireAdmin(admin);
  const a = getAttemptRow(attemptId);
  if (!a) throw new HttpError(404, "not_found", "Not found");
  return refreshExpiry(a);
}

export function reviewsFor(attemptId: string) {
  return db()
    .prepare(
      `SELECT r.question_code, r.score, r.private_notes, r.reviewer_id, r.updated_at, u.full_name AS reviewer_name
       FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.attempt_id = ? ORDER BY r.updated_at`,
    )
    .all(attemptId) as { question_code: string; score: number | null; private_notes: string; reviewer_id: string; updated_at: string; reviewer_name: string }[];
}

export function saveReview(admin: Actor, attemptId: string, questionCode: string, input: { score: number | null; private_notes?: string }) {
  const a = adminAttempt(admin, attemptId);
  const snap = snapshotOf(a);
  if (!snap.questions.some((q) => q.code === questionCode)) throw new HttpError(404, "not_found", "题目不存在 / Question not found");
  if (input.score !== null && (!Number.isInteger(input.score) || input.score < 1 || input.score > 5)) throw new HttpError(400, "invalid_score", "评分须为1–5 / Score must be 1–5");
  const ts = now();
  db()
    .prepare(
      `INSERT INTO reviews (id, attempt_id, question_code, reviewer_id, score, private_notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(attempt_id, question_code, reviewer_id) DO UPDATE SET score = excluded.score,
         private_notes = CASE WHEN ? THEN excluded.private_notes ELSE reviews.private_notes END, updated_at = excluded.updated_at`,
    )
    .run(id("rev"), a.id, questionCode, admin.id, input.score, (input.private_notes ?? "").slice(0, 5000), ts, ts, input.private_notes !== undefined ? 1 : 0);
  audit(admin, "save_review", "attempt", a.id, { question: questionCode, score: input.score });
}

export function reopenAttempt(admin: Actor, attemptId: string, reason: string, extendMinutes = 0) {
  const a = adminAttempt(admin, attemptId);
  if (!reason.trim()) throw new HttpError(400, "reason_required", "请填写原因 / Reason required");
  if (a.status === "in_progress" || a.status === "reopened") throw new HttpError(409, "conflict", "测评仍在进行中 / Attempt is still open");
  const d = db();
  const extra = Math.max(0, Math.round(extendMinutes * 60));
  let deadline = a.deadline_at;
  if (deadline) {
    // Give at least the extension from now if the deadline already passed.
    const base = Math.max(Date.parse(deadline), Date.now());
    deadline = new Date(base + extra * 1000).toISOString();
  }
  d.prepare("UPDATE attempts SET status = 'reopened', submitted_at = NULL, deadline_at = ?, extension_seconds = extension_seconds + ? WHERE id = ?").run(deadline, extra, a.id);
  d.prepare("UPDATE answers SET submitted_at = NULL WHERE attempt_id = ?").run(a.id);
  logEvent(a.id, "reopened", null, { by: admin.id, extend_minutes: extendMinutes });
  audit(admin, "reopen_attempt", "attempt", a.id, { reason: reason.slice(0, 500), extend_minutes: extendMinutes, previous_status: a.status, previous_submitted_at: a.submitted_at });
}

export function extendAttempt(admin: Actor, attemptId: string, minutes: number, reason: string) {
  const a = adminAttempt(admin, attemptId);
  if (!reason.trim()) throw new HttpError(400, "reason_required", "请填写原因 / Reason required");
  if (!(minutes > 0 && minutes <= 600)) throw new HttpError(400, "invalid", "延长时间须为1–600分钟 / Extension must be 1–600 minutes");
  if (!a.deadline_at) throw new HttpError(409, "no_deadline", "该测评没有硬性时限 / This attempt has no hard cap");
  const extra = Math.round(minutes * 60);
  const base = a.status === "expired" ? Math.max(Date.parse(a.deadline_at), Date.now()) : Date.parse(a.deadline_at);
  const deadline = new Date(base + extra * 1000).toISOString();
  const status = a.status === "expired" ? "reopened" : a.status;
  db().prepare("UPDATE attempts SET deadline_at = ?, extension_seconds = extension_seconds + ?, status = ? WHERE id = ?").run(deadline, extra, status, a.id);
  logEvent(a.id, "extended", null, { minutes });
  audit(admin, "extend_attempt", "attempt", a.id, { minutes, reason: reason.slice(0, 500) });
}

export function setArchived(admin: Actor, attemptId: string, archived: boolean) {
  const a = adminAttempt(admin, attemptId);
  db().prepare("UPDATE attempts SET archived_at = ? WHERE id = ?").run(archived ? now() : null, a.id);
  audit(admin, archived ? "archive_attempt" : "unarchive_attempt", "attempt", a.id);
}

export function setPasteAccommodation(admin: Actor, attemptId: string, allowed: boolean, requestId?: string) {
  const a = adminAttempt(admin, attemptId);
  const d = db();
  d.prepare("UPDATE attempts SET paste_accommodation = ? WHERE id = ?").run(allowed ? 1 : 0, a.id);
  if (requestId) d.prepare("UPDATE accommodation_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND attempt_id = ?").run(allowed ? "granted" : "declined", admin.id, now(), requestId, a.id);
  logEvent(a.id, allowed ? "paste_accommodation_granted" : "paste_accommodation_revoked");
  audit(admin, "paste_accommodation", "attempt", a.id, { allowed, request: requestId ?? null });
}

export function resolveAccommodation(admin: Actor, attemptId: string, requestId: string, status: "granted" | "declined") {
  const a = adminAttempt(admin, attemptId);
  const res = db()
    .prepare("UPDATE accommodation_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND attempt_id = ?")
    .run(status, admin.id, now(), requestId, a.id);
  if (res.changes !== 1) throw new HttpError(404, "not_found", "Not found");
  audit(admin, "resolve_accommodation", "attempt", a.id, { request: requestId, status });
}

export function accommodationsFor(attemptId: string) {
  return db().prepare("SELECT * FROM accommodation_requests WHERE attempt_id = ? ORDER BY created_at").all(attemptId) as {
    id: string;
    kind: string;
    message: string;
    status: "open" | "granted" | "declined";
    created_at: string;
    resolved_at: string | null;
  }[];
}

export function eventsFor(attemptId: string) {
  return db().prepare("SELECT question_code, event_type, metadata, occurred_at FROM activity_events WHERE attempt_id = ? ORDER BY occurred_at").all(attemptId) as {
    question_code: string | null;
    event_type: string;
    metadata: string;
    occurred_at: string;
  }[];
}

export const INTEGRITY_EVENT_TYPES = ["copy_blocked", "cut_blocked", "contextmenu_blocked", "paste_blocked", "drop_blocked", "visibility_hidden"];

/** Wall-clock elapsed: started → submitted (or now). The MVP timer keeps running when the tab is closed. */
export function elapsedSeconds(a: Pick<AttemptRow, "started_at" | "submitted_at">, at = Date.now()): number {
  const end = a.submitted_at ? Date.parse(a.submitted_at) : at;
  return Math.max(0, Math.floor((end - Date.parse(a.started_at)) / 1000));
}
