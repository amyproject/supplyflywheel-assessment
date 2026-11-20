import { route, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { queueTranscription } from "@/lib/recordings";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => {
  const r = queueTranscription(requireActor(actor), params.id);
  return json({ id: r.id, transcription_status: r.transcription_status }, 202);
});
