import { route, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { dashboardRows } from "@/lib/admin";

export const GET = route(async (req, { actor }) => {
  const admin = requireAdminActor(actor);
  const sp = req.nextUrl.searchParams;
  const rows = dashboardRows(admin, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, band: sp.get("band") ?? undefined });
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(sp.get("page_size") ?? 50) || 50));
  return json({ total: rows.length, page, page_size: size, rows: rows.slice((page - 1) * size, page * size) });
});
