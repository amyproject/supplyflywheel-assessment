import { z } from "zod";
import { NextResponse } from "next/server";
import { route, readJson } from "@/lib/api";
import { authenticate, createSession, sessionCookieOptions, SESSION_COOKIE, isAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { HttpError } from "@/lib/http";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const body = Body.parse(await readJson(req));
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  if (!rateLimit(`signin:${ip}`, 30, 600) || !rateLimit(`signin:${body.email.toLowerCase()}`, 10, 600)) {
    throw new HttpError(429, "rate_limited", "尝试次数过多，请稍后再试 / Too many attempts, try again later");
  }
  const actor = authenticate(body.email, body.password);
  const { token, expires } = createSession(actor.id);
  const res = NextResponse.json({ ok: true, redirect: isAdmin(actor) ? "/admin" : "/candidate" });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
  return res;
});
