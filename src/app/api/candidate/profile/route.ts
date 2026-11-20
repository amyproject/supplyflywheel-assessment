import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { updateCandidateProfile } from "@/lib/assessment";
import { HttpError } from "@/lib/http";

const Body = z.object({ full_name: z.string().min(1).max(100), phone: z.string().max(40).nullish(), location: z.string().max(100).nullish() });

export const POST = route(async (req, { actor }) => {
  const a = requireActor(actor);
  if (a.role !== "candidate") throw new HttpError(403, "forbidden", "Forbidden");
  const b = Body.parse(await readJson(req));
  updateCandidateProfile(a, { full_name: b.full_name, phone: b.phone ?? null, location: b.location ?? null });
  return json({ ok: true });
});
