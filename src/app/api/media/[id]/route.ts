import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { actorFromRequest } from "@/lib/api";
import { authorizeMedia } from "@/lib/recordings";
import { HttpError } from "@/lib/http";

/** Streams a private recording. Requires the session AND a signed, unexpired URL bound to that user. Supports Range for seeking. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = actorFromRequest(req);
    if (!actor) throw new HttpError(401, "unauthenticated", "Unauthenticated");
    const { id } = await ctx.params;
    const sp = req.nextUrl.searchParams;
    const dl = sp.get("dl") === "1";
    const rangeHeader = req.headers.get("range");
    // Audio elements issue several Range requests per play; audit only the first one.
    const log = !rangeHeader || /^bytes=0-/.test(rangeHeader);
    const file = authorizeMedia(actor, id, { exp: sp.get("exp"), sig: sp.get("sig"), dl, log });
    const size = fs.statSync(file.path).size;
    const headers: Record<string, string> = {
      "Content-Type": file.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (dl) headers["Content-Disposition"] = `attachment; filename="${id}.${file.mime.split("/")[1] ?? "audio"}"`;
    const range = req.headers.get("range");
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const stream = Readable.toWeb(fs.createReadStream(file.path, { start, end })) as ReadableStream;
      return new NextResponse(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream;
    return new NextResponse(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return NextResponse.json({ error: e instanceof HttpError ? e.code : "server_error" }, { status });
  }
}
