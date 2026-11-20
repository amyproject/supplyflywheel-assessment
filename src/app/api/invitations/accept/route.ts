import { z } from "zod";
import { NextResponse } from "next/server";
import { route, readJson } from "@/lib/api";
import { acceptInvitation } from "@/lib/assessment";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { HttpError } from "@/lib/http";

const Body = z.object({
  token: z.string().min(10).max(200),
  password: z.string().max(200).optional(),
  full_name: z.string().max(100).optional(),
  phone: z.string().max(40).nullish(),
  location: z.string().max(100).nullish(),
});

export const POST = route(async (req, { actor }) => {
  const body = Body.parse(await readJson(req));
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  if (!rateLimit(`accept:${ip}`, 20, 600)) throw new HttpError(429, "rate_limited", "请求过于频繁 / Too many requests");
  const candidate = acceptInvitation(body.token, { actor, password: body.password, full_name: body.full_name, phone: body.phone, location: body.location });
  const res = NextResponse.json({ ok: true, redirect: "/candidate" });
  if (!actor) {
    const { token, expires } = createSession(candidate.id);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
  }
  return res;
});
