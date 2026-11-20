import { NextResponse, type NextRequest } from "next/server";

/** Turns the picker form's repeated ?pick= values into ?ids=a,b,c. */
export function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.getAll("pick").slice(0, 6);
  const url = req.nextUrl.clone();
  url.pathname = "/admin/compare";
  url.search = ids.length ? `?ids=${ids.join(",")}` : "";
  return NextResponse.redirect(url);
}
