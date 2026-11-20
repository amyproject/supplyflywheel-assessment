import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/http";
import { type Actor, SESSION_COOKIE, actorFromToken } from "@/lib/auth";

export function actorFromRequest(req: NextRequest): Actor | null {
  return actorFromToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * CSRF defence for cookie-authenticated mutations: SameSite=Lax cookies plus an
 * Origin/Referer check against the Host header.
 */
export function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw new HttpError(403, "csrf", "Missing origin");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "csrf", "Bad origin");
  }
  if (!host || originHost !== host) throw new HttpError(403, "csrf", "Cross-origin request blocked");
}

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: origin check, actor resolution, uniform JSON errors. */
export function route<P = Record<string, string>>(handler: (req: NextRequest, ctx: { actor: Actor | null; params: P }) => Promise<Response> | Response) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      const params = (await ctx?.params) ?? ({} as P);
      return await handler(req, { actor: actorFromRequest(req), params });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "invalid_input", message: "输入无效 / Invalid input", issues: e.issues.slice(0, 5) }, { status: 400 });
      console.error("[api]", e);
      const code = (e as { code?: string })?.code;
      if (code === "EROFS" || code === "EACCES" || code === "SQLITE_CANTOPEN" || code === "SQLITE_READONLY") {
        return NextResponse.json({ error: "storage_unavailable", message: "服务器存储不可用：请在支持持久磁盘的主机上部署（见 README）/ Server storage unavailable: deploy on a host with a persistent disk (see README)" }, { status: 503 });
      }
      return NextResponse.json({ error: "server_error", message: "服务器错误 / Server error" }, { status: 500 });
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (text.length > 200_000) throw new HttpError(413, "too_large", "Payload too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json", "Invalid JSON");
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
