import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { exportCsv } from "@/lib/admin";

export const GET = route(async (req, { actor }) => {
  const admin = requireAdminActor(actor);
  const sp = req.nextUrl.searchParams;
  const detail = sp.get("detail") === "answers" ? "answers" : "summary";
  const csv = exportCsv(admin, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, band: sp.get("band") ?? undefined }, detail);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="supplyflywheel-assessment-${detail}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
