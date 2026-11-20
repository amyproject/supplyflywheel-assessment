import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { startAttempt } from "@/lib/assessment";

const Body = z.object({ invitation_id: z.string().max(80), consent_terms: z.boolean(), consent_recording: z.boolean() });

export const POST = route(async (req, { actor }) => {
  const a = requireActor(actor);
  const b = Body.parse(await readJson(req));
  const attempt = startAttempt(a, b);
  return json({ id: attempt.id, started_at: attempt.started_at, redirect: `/candidate/assessment/${attempt.id}` }, 201);
});
