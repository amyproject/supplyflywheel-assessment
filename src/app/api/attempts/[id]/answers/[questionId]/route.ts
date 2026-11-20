import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { saveAnswer } from "@/lib/assessment";

const Body = z.object({
  rev: z.number().int().min(0).optional(),
  typed_text: z.string().max(20_000).optional(),
  corrected_transcript: z.string().max(20_000).nullable().optional(),
  seq: z.number().int().min(0).optional(),
  active_delta: z.number().min(0).max(3600).optional(),
  opened: z.boolean().optional(),
  left: z.boolean().optional(),
});

/** Idempotent autosave (see saveAnswer). POST is accepted too so navigator.sendBeacon-style keepalive works. */
const handler = route<{ id: string; questionId: string }>(async (req, { actor, params }) => {
  const b = Body.parse(await readJson(req));
  return json(saveAnswer(requireActor(actor), params.id, params.questionId, b));
});
export const PATCH = handler;
export const POST = handler;
