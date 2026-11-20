import { route, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { saveRecording } from "@/lib/recordings";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/http";

/** Multipart upload of one finished take: file, question_code, duration_seconds. */
export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const a = requireActor(actor);
  const len = Number(req.headers.get("content-length") || 0);
  if (len > config.maxRecordingBytes + 64 * 1024) throw new HttpError(413, "too_large", "录音文件过大 / Recording too large");
  const form = await req.formData();
  const file = form.get("file");
  const code = String(form.get("question_code") ?? "");
  const duration = Number(form.get("duration_seconds") ?? 0);
  if (!(file instanceof Blob)) throw new HttpError(400, "no_file", "缺少录音文件 / Missing file");
  if (file.size > config.maxRecordingBytes) throw new HttpError(413, "too_large", "录音文件过大 / Recording too large");
  const rec = saveRecording(a, params.id, code, { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type || "audio/webm", duration_seconds: duration });
  return json({ id: rec.id, duration_seconds: rec.duration_seconds, mime_type: rec.mime_type, transcription_status: rec.transcription_status }, 201);
});
