import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Liveness + storage check for the host's health probe. Reports no data. */
export function GET() {
  try {
    db().prepare("SELECT 1").get();
    fs.mkdirSync(config.storageDir, { recursive: true });
    const probe = path.join(config.storageDir, ".write-test");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return NextResponse.json({ ok: true, admin_configured: Boolean(process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD ?? "").length >= 12) });
  } catch (e) {
    console.error("[health]", e);
    return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
  }
}
