import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { requestAccommodation } from "@/lib/assessment";

const Body = z.object({ kind: z.enum(["paste", "time", "other"]), message: z.string().min(1).max(1000) });

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const b = Body.parse(await readJson(req));
  requestAccommodation(requireActor(actor), params.id, b.kind, b.message);
  return json({ ok: true }, 201);
});
