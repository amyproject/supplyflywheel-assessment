import { z } from "zod";
import { NextResponse } from "next/server";
import { route, readJson } from "@/lib/api";
import { startPublicAttempt } from "@/lib/assessment";
import { createSession, isAdmin, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { HttpError } from "@/lib/http";

const Body = z.object({
  full_name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(40).nullish(),
  location: z.string().max(100).nullish(),
  access_code: z.string().max(100).nullish(),
  consent_terms: z.boolean(),
  consent_recording: z.boolean(),
});

/** No-login start: creates (or reuses) a candidate record, a session cookie and the attempt. */
export const POST = route(async (req, { actor }) => {
  if (actor && isAdmin(actor)) throw new HttpError(409, "admin_session", "请先退出管理员账户再参加测评 / Sign out of the admin account before taking the test");
  const b = Body.parse(await readJson(req));
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  if (!rateLimit(`start:${ip}`, 12, 3600)) throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后再试 / Too many attempts, try again later");
  const { candidate, attempt } = startPublicAttempt(b);
  const res = NextResponse.json({ id: attempt.id, redirect: `/candidate/assessment/${attempt.id}` }, { status: 201 });
  const { token, expires } = createSession(candidate.id);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
  return res;
});
