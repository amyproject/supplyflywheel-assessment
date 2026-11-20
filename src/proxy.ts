import { NextResponse, type NextRequest } from "next/server";

/** Optimistic gate only: real authorization happens in every page (requireXPage) and API route (route()). */
export function proxy(req: NextRequest) {
  if (!req.cookies.get("sfa_session")?.value) {
    const url = req.nextUrl.clone();
    const admin = req.nextUrl.pathname.startsWith("/admin");
    url.pathname = admin ? "/auth/sign-in" : "/start";
    url.search = admin ? `?next=${encodeURIComponent(req.nextUrl.pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/candidate/:path*"] };
