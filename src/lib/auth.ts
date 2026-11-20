import "server-only";
import crypto from "node:crypto";
import { db, id, now, sha256 } from "@/lib/db";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/http";

export const SESSION_COOKIE = "sfa_session";

export type Role = "candidate" | "admin" | "super_admin";

export interface Actor {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  location: string | null;
  role: Role;
  created_at: string;
}

export const isAdmin = (a: Pick<Actor, "role"> | null | undefined) => a?.role === "admin" || a?.role === "super_admin";

export { hashPassword, verifyPassword } from "@/lib/password";
import { hashPassword, verifyPassword } from "@/lib/password";

const USER_COLS = "id, email, full_name, phone, location, role, created_at";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getUser(userId: string): Actor | undefined {
  return db().prepare(`SELECT ${USER_COLS} FROM users WHERE id = ? AND disabled_at IS NULL`).get(userId) as Actor | undefined;
}

export function findUserByEmail(email: string): (Actor & { password_hash: string | null; disabled_at: string | null }) | undefined {
  return db().prepare(`SELECT ${USER_COLS}, password_hash, disabled_at FROM users WHERE email = ?`).get(normalizeEmail(email)) as
    | (Actor & { password_hash: string | null; disabled_at: string | null })
    | undefined;
}

export function createUser(input: { email: string; full_name: string; password?: string; role: Role; phone?: string | null; location?: string | null }): Actor {
  const uid = id("usr");
  db()
    .prepare("INSERT INTO users (id, email, full_name, phone, location, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(uid, normalizeEmail(input.email), input.full_name.trim(), input.phone?.trim() || null, input.location?.trim() || null, input.role, input.password ? hashPassword(input.password) : null, now());
  return getUser(uid)!;
}

/** Email + password check. Same error for unknown email and wrong password. */
export function authenticate(email: string, password: string): Actor {
  const u = findUserByEmail(email);
  // Run scrypt even for unknown users so timing doesn't reveal which emails exist.
  const ok = verifyPassword(password, u?.password_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!u || !ok || u.disabled_at) throw new HttpError(401, "invalid_credentials", "邮箱或密码不正确 / Incorrect email or password");
  return getUser(u.id)!;
}

// ---------- sessions ----------
export function createSession(userId: string): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db().prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(sha256(token), userId, expires.toISOString(), now());
  return { token, expires };
}

export function destroySession(token: string | undefined) {
  if (token) db().prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function actorFromToken(token: string | undefined | null): Actor | null {
  if (!token) return null;
  const d = db();
  const row = d
    .prepare(`SELECT u.id, u.email, u.full_name, u.phone, u.location, u.role, u.created_at, s.expires_at
              FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND u.disabled_at IS NULL`)
    .get(sha256(token)) as (Actor & { expires_at: string }) | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    d.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
    return null;
  }
  const { expires_at: _e, ...actor } = row;
  void _e;
  return actor;
}

export const sessionCookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires,
});

// ---------- one-time sign-in links ----------
export function createLoginLink(userId: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  db()
    .prepare("INSERT INTO login_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sha256(token), userId, new Date(Date.now() + 15 * 60_000).toISOString());
  return token;
}

/** Consumes a sign-in link exactly once. */
export function consumeLoginLink(token: string): Actor | null {
  const d = db();
  const row = d.prepare("SELECT user_id, expires_at, used_at FROM login_links WHERE token_hash = ?").get(sha256(token)) as
    | { user_id: string; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || row.expires_at < now()) return null;
  const res = d.prepare("UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(now(), sha256(token));
  if (res.changes !== 1) return null;
  return getUser(row.user_id) ?? null;
}

// ---------- guards ----------
export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new HttpError(401, "unauthenticated", "请先登录 / Please sign in");
  return actor;
}

export function requireAdminActor(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (!isAdmin(a)) throw new HttpError(403, "forbidden", "无权访问 / Forbidden");
  return a;
}

export function requireSuperAdminActor(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (a.role !== "super_admin") throw new HttpError(403, "forbidden", "仅超级管理员 / Super admin only");
  return a;
}
