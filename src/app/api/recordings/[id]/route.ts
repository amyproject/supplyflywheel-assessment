import { route, json } from "@/lib/api";
import { isAdmin, requireActor } from "@/lib/auth";
import { adminAttempt, ownAttempt, answersFor } from "@/lib/assessment";
import { deleteRecording, getRecording, signedMediaUrl } from "@/lib/recordings";
import { HttpError } from "@/lib/http";

/** Status poll for a recording (transcription progress) plus a fresh signed playback URL. */
export const GET = route<{ id: string }>(async (_req, { actor, params }) => {
  const a = requireActor(actor);
  const r = getRecording(params.id);
  if (!r || r.deleted_at) throw new HttpError(404, "not_found", "Not found");
  if (isAdmin(a)) adminAttempt(a, r.attempt_id);
  else ownAttempt(a, r.attempt_id);
  const ans = answersFor(r.attempt_id).find((x) => x.id === r.answer_id)!;
  return json({
    id: r.id,
    transcription_status: r.transcription_status,
    transcription_error: r.transcription_error,
    machine_transcript: ans.machine_transcript,
    corrected_transcript: ans.corrected_transcript,
    rev: ans.rev,
    play_url: signedMediaUrl(r.id, a.id),
  });
});

export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  deleteRecording(requireActor(actor), params.id);
  return json({ ok: true });
});
