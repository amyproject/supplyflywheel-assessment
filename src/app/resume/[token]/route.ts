import { NextResponse, type NextRequest } from "next/server";
import { attemptFromResumeToken } from "@/lib/assessment";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/db";

/** Private resume link: signs this browser in as the attempt's candidate and returns to the test. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  const url = req.nextUrl.clone();
  url.search = "";
  const a = rateLimit(`resume:${ip}`, 30, 600) ? attemptFromResumeToken(token) : null;
  if (!a) {
    url.pathname = "/start";
    url.searchParams.set("error", "resume");
    return NextResponse.redirect(url);
  }
  url.pathname = a.status === "submitted" ? "/candidate/submitted" : `/candidate/assessment/${a.id}`;
  if (a.status === "submitted") url.searchParams.set("attempt", a.id);
  const res = NextResponse.redirect(url);
  const { token: session, expires } = createSession(a.candidate_id);
  res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions(expires));
  return res;
}
