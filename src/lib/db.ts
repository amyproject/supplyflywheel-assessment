import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "@/lib/config";
import { CATEGORIES, QUESTIONS, SCENARIO } from "@/lib/questions";
import { hashPassword, verifyPassword } from "@/lib/password";

type DB = Database.Database;

const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  role TEXT NOT NULL CHECK (role IN ('candidate','admin','super_admin')),
  password_hash TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- sha256(token); the raw token only lives in the cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE assessment_templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh-CN',
  scenario_json TEXT NOT NULL,
  categories_json TEXT NOT NULL,
  recommended_seconds INTEGER NOT NULL DEFAULT 1800,
  overall_limit_seconds INTEGER,            -- hard cap; NULL = none
  auto_submit_on_expiry INTEGER NOT NULL DEFAULT 0,
  copy_restriction_enabled INTEGER NOT NULL DEFAULT 1,
  paste_restriction_enabled INTEGER NOT NULL DEFAULT 1,
  allow_navigation INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (slug, version)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES assessment_templates(id) ON DELETE CASCADE,
  question_code TEXT NOT NULL,
  category TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  prompt_zh TEXT NOT NULL,
  prompt_en TEXT NOT NULL,
  rubric_zh TEXT NOT NULL,
  rubric_en TEXT NOT NULL,
  category_weight INTEGER NOT NULL,
  soft_limit_seconds INTEGER NOT NULL DEFAULT 90,
  hard_limit_seconds INTEGER,
  UNIQUE (template_id, question_code)
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES assessment_templates(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  candidate_id TEXT REFERENCES users(id),
  revoked_at TEXT,
  last_sent_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX invitations_email ON invitations(email);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES users(id),
  template_id TEXT NOT NULL REFERENCES assessment_templates(id),
  invitation_id TEXT REFERENCES invitations(id),
  status TEXT NOT NULL CHECK (status IN ('in_progress','submitted','expired','reopened')),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  last_active_at TEXT NOT NULL,
  deadline_at TEXT,
  extension_seconds INTEGER NOT NULL DEFAULT 0,
  total_active_seconds INTEGER NOT NULL DEFAULT 0,
  heartbeat_seq INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  current_question_code TEXT,
  consent_terms_at TEXT NOT NULL,
  consent_recording_at TEXT,
  paste_accommodation INTEGER NOT NULL DEFAULT 0,
  template_snapshot TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX attempts_candidate ON attempts(candidate_id);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_code TEXT NOT NULL,
  typed_text TEXT NOT NULL DEFAULT '',
  machine_transcript TEXT,
  transcript_provider TEXT,
  corrected_transcript TEXT,
  first_opened_at TEXT,
  last_left_at TEXT,
  active_duration_seconds INTEGER NOT NULL DEFAULT 0,
  recording_duration_seconds INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT,
  submitted_at TEXT,
  UNIQUE (attempt_id, question_code)
);

CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  transcription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (transcription_status IN ('none','queued','processing','done','failed','unavailable')),
  transcription_error TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX recordings_answer ON recordings(answer_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_code TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  private_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (attempt_id, question_code, reviewer_id)
);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_code TEXT,
  event_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);
CREATE INDEX activity_attempt ON activity_events(attempt_id, occurred_at);

CREATE TABLE accommodation_requests (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','granted','declined')),
  created_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT
);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);
CREATE INDEX audit_time ON admin_audit_logs(occurred_at);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
`,
  },
];

const globalForDb = globalThis as unknown as { __assessDb?: DB };

function open(): DB {
  const file = config.databasePath;
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  migrate(d);
  ensureDefaultTemplate(d);
  syncTemplateQuestions(d);
  ensureBootstrapAdmin(d);
  return d;
}

function migrate(d: DB) {
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set((d.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    d.transaction(() => {
      d.exec(m.sql);
      d.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, now());
    })();
  }
}

export const DEFAULT_TEMPLATE_SLUG = "robotics-supply-chain-lead";

/** Seed version 1 of the default template (idempotent). */
function ensureDefaultTemplate(d: DB) {
  const exists = d.prepare("SELECT 1 FROM assessment_templates WHERE slug = ?").get(DEFAULT_TEMPLATE_SLUG);
  if (exists) return;
  const tid = id("tpl");
  d.transaction(() => {
    d.prepare(
      `INSERT INTO assessment_templates (id, slug, title, version, scenario_json, categories_json, recommended_seconds, overall_limit_seconds,
         auto_submit_on_expiry, copy_restriction_enabled, paste_restriction_enabled, allow_navigation, published_at, created_at)
       VALUES (?, ?, ?, 1, ?, ?, 1800, 1800, 1, 1, 1, 1, ?, ?)`,
    ).run(tid, DEFAULT_TEMPLATE_SLUG, "机器人供应链负责人测评", JSON.stringify(SCENARIO), JSON.stringify(CATEGORIES), now(), now());
    const ins = d.prepare(
      `INSERT INTO questions (id, template_id, question_code, category, display_order, prompt_zh, prompt_en, rubric_zh, rubric_en, category_weight, soft_limit_seconds, hard_limit_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const q of QUESTIONS) {
      const w = CATEGORIES.find((c) => c.code === q.category)!.weight;
      ins.run(id("q"), tid, q.code, q.category, q.order, q.prompt_zh, q.prompt_en, q.rubric_zh, q.rubric_en, w, q.soft_limit_seconds, q.hard_limit_seconds);
    }
  })();
}

/**
 * If the seed question list changed (e.g. a question was removed), publish a new template version that
 * keeps the latest settings but uses the seed questions. Started attempts keep their own snapshot.
 */
function syncTemplateQuestions(d: DB) {
  const t = d.prepare("SELECT * FROM assessment_templates WHERE slug = ? ORDER BY version DESC LIMIT 1").get(DEFAULT_TEMPLATE_SLUG) as Record<string, unknown> & { id: string; version: number };
  const codes = (d.prepare("SELECT question_code FROM questions WHERE template_id = ? ORDER BY display_order").all(t.id) as { question_code: string }[]).map((r) => r.question_code);
  if (codes.join(",") === QUESTIONS.map((q) => q.code).join(",")) return;
  const soft = (d.prepare("SELECT soft_limit_seconds FROM questions WHERE template_id = ? LIMIT 1").get(t.id) as { soft_limit_seconds: number } | undefined)?.soft_limit_seconds ?? 90;
  const tid = id("tpl");
  d.transaction(() => {
    d.prepare(
      `INSERT INTO assessment_templates (id, slug, title, version, language, scenario_json, categories_json, recommended_seconds, overall_limit_seconds,
         auto_submit_on_expiry, copy_restriction_enabled, paste_restriction_enabled, allow_navigation, published_at, created_at)
       VALUES (?, ?, ?, ?, 'zh-CN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(tid, DEFAULT_TEMPLATE_SLUG, t.title, t.version + 1, JSON.stringify(SCENARIO), JSON.stringify(CATEGORIES), t.recommended_seconds, t.overall_limit_seconds,
      t.auto_submit_on_expiry, t.copy_restriction_enabled, t.paste_restriction_enabled, t.allow_navigation, now(), now());
    const ins = d.prepare(
      `INSERT INTO questions (id, template_id, question_code, category, display_order, prompt_zh, prompt_en, rubric_zh, rubric_en, category_weight, soft_limit_seconds, hard_limit_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const q of QUESTIONS) ins.run(id("q"), tid, q.code, q.category, q.order, q.prompt_zh, q.prompt_en, q.rubric_zh, q.rubric_en, CATEGORIES.find((c) => c.code === q.category)!.weight, soft, q.hard_limit_seconds);
  })();
}

/**
 * First-run admin for deployments: if ADMIN_EMAIL + ADMIN_PASSWORD (12+ chars) are set, make sure that
 * account exists as a super admin with that password. The env var is the source of truth for this one
 * account, so changing ADMIN_PASSWORD on the host and restarting resets it.
 */
function ensureBootstrapAdmin(d: DB) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) {
    console.warn("[assessment] ADMIN_PASSWORD must be at least 12 characters; bootstrap admin not created");
    return;
  }
  const u = d.prepare("SELECT id, role, password_hash FROM users WHERE email = ?").get(email) as { id: string; role: string; password_hash: string | null } | undefined;
  if (!u) {
    d.prepare("INSERT INTO users (id, email, full_name, role, password_hash, created_at) VALUES (?, ?, ?, 'super_admin', ?, ?)").run(id("usr"), email, "SupplyFlywheel Admin", hashPassword(password), now());
    console.info(`[assessment] created super admin ${email}`);
    return;
  }
  if (u.role === "candidate") {
    console.warn(`[assessment] ADMIN_EMAIL ${email} belongs to a candidate; not promoting it`);
    return;
  }
  if (!verifyPassword(password, u.password_hash)) {
    d.prepare("UPDATE users SET password_hash = ?, disabled_at = NULL WHERE id = ?").run(hashPassword(password), u.id);
    d.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    console.info(`[assessment] reset password for ${email} from ADMIN_PASSWORD`);
  }
}

/**
 * HMAC secret for signed media URLs and resume links: SESSION_SECRET if set, otherwise a random secret
 * generated once and stored in the database (so a deploy works without extra config).
 */
export function appSecret(): string {
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 16) return env;
  const cur = getSetting("app_secret", "");
  if (cur) return cur;
  const s = crypto.randomBytes(32).toString("hex");
  db().prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('app_secret', ?)").run(s);
  return getSetting("app_secret", s);
}

/** Process-wide singleton (survives Next dev hot reloads). */
export function db(): DB {
  if (!globalForDb.__assessDb) globalForDb.__assessDb = open();
  return globalForDb.__assessDb;
}

export function resetDbForTests() {
  globalForDb.__assessDb?.close();
  globalForDb.__assessDb = undefined;
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function getSetting(key: string, fallback: string): string {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Fixed-window rate limiter backed by SQLite. Returns false when the caller is over the limit. */
export function rateLimit(key: string, limit: number, windowSeconds: number): boolean {
  const d = db();
  const nowS = Math.floor(Date.now() / 1000);
  const row = d.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").get(key) as { window_start: number; count: number } | undefined;
  if (!row || nowS - row.window_start >= windowSeconds) {
    d.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1").run(key, nowS);
    return true;
  }
  if (row.count >= limit) return false;
  d.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
  return true;
}
