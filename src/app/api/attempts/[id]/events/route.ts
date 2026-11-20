import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { recordClientEvents } from "@/lib/assessment";

const Body = z.object({
  events: z.array(z.object({ type: z.string().max(40), question_code: z.string().max(10).nullish(), meta: z.record(z.string(), z.unknown()).optional() })).max(20),
});

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const b = Body.parse(await readJson(req));
  return json(recordClientEvents(requireActor(actor), params.id, b.events));
});
