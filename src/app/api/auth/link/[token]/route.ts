import { NextResponse, type NextRequest } from "next/server";
import { consumeLoginLink, createSession, isAdmin, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const actor = consumeLoginLink(token);
  const url = req.nextUrl.clone();
  url.search = "";
  if (!actor) {
    url.pathname = "/auth/sign-in";
    url.searchParams.set("error", "link");
    return NextResponse.redirect(url);
  }
  url.pathname = isAdmin(actor) ? "/admin" : "/candidate";
  const res = NextResponse.redirect(url);
  const { token: session, expires } = createSession(actor.id);
  res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions(expires));
  return res;
}
