import { route, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { grantRecordingConsent } from "@/lib/assessment";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => {
  grantRecordingConsent(requireActor(actor), params.id);
  return json({ ok: true });
});
