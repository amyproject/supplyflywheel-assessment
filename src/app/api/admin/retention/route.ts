import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireSuperAdminActor } from "@/lib/auth";
import { setSetting } from "@/lib/db";
import { audit } from "@/lib/assessment";
import { purgeRecordingsOlderThan } from "@/lib/recordings";

const Body = z.object({ retention_days: z.number().int().min(7).max(3650), purge_now: z.boolean().optional() });

export const POST = route(async (req, { actor }) => {
  const sa = requireSuperAdminActor(actor);
  const b = Body.parse(await readJson(req));
  setSetting("retention_days", String(b.retention_days));
  audit(sa, "set_retention", "settings", null, { retention_days: b.retention_days });
  const purged = b.purge_now ? purgeRecordingsOlderThan(sa, b.retention_days) : 0;
  return json({ ok: true, purged });
});
