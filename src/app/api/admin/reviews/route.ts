import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { adminAttempt, saveReview } from "@/lib/assessment";
import { scoreForAttempt } from "@/lib/admin";
import { band } from "@/lib/scoring";

const Body = z.object({
  attempt_id: z.string().max(80),
  question_code: z.string().max(10),
  score: z.number().int().min(1).max(5).nullable(),
  private_notes: z.string().max(5000).optional(),
});

export const POST = route(async (req, { actor }) => {
  const admin = requireAdminActor(actor);
  const b = Body.parse(await readJson(req));
  saveReview(admin, b.attempt_id, b.question_code, { score: b.score, private_notes: b.private_notes });
  const s = scoreForAttempt(adminAttempt(admin, b.attempt_id));
  return json({ ok: true, score: s, band: band(s.final) });
});
