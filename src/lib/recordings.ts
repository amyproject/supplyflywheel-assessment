import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, id, now, rateLimit } from "@/lib/db";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/http";
import { type Actor, isAdmin } from "@/lib/auth";
import { type AnswerRow, type RecordingRow, audit, isEditable, logEvent, ownAttempt, adminAttempt } from "@/lib/assessment";
import { transcribeAudio } from "@/lib/transcribe";

/** Container formats MediaRecorder produces across Chrome/Firefox/Safari, plus common uploads. */
const ALLOWED_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function baseMime(mime: string) {
  return mime.split(";")[0].trim().toLowerCase();
}

/** Light magic-byte sniff so a renamed non-audio file is rejected. */
export function looksLikeAudio(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;
  const m = baseMime(mime);
  const head = buf.subarray(0, 12);
  if (m === "audio/webm") return head.readUInt32BE(0) === 0x1a45dfa3;
  if (m === "audio/ogg") return head.toString("ascii", 0, 4) === "OggS";
  if (m === "audio/wav" || m === "audio/x-wav") return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE";
  if (m === "audio/mp4" || m === "audio/x-m4a") return head.toString("ascii", 4, 8) === "ftyp";
  if (m === "audio/mpeg") return head.toString("ascii", 0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (m === "audio/aac") return head[0] === 0xff && (head[1] & 0xf0) === 0xf0;
  return false;
}

function storagePathFor(attemptId: string, recId: string, ext: string) {
  // Path built only from server-generated IDs; never from user input.
  return path.join(attemptId, `${recId}.${ext}`);
}

function absolute(rel: string) {
  const root = path.resolve(config.storageDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new HttpError(400, "bad_path", "Bad path");
  return abs;
}

/**
 * Store a finished recording for one answer. Re-recording replaces the previous take
 * (the old file is deleted; the row is kept, soft-deleted, for the audit trail).
 */
export function saveRecording(actor: Actor, attemptId: string, questionCode: string, input: { bytes: Buffer; mime: string; duration_seconds: number }): RecordingRow {
  const a = ownAttempt(actor, attemptId);
  if (!isEditable(a)) throw new HttpError(409, "locked", "答案已锁定 / Answers are locked");
  if (!a.consent_recording_at) throw new HttpError(403, "consent_required", "未同意录音 / Recording consent not given");
  if (!rateLimit(`rec:${a.id}`, 60, 3600)) throw new HttpError(429, "rate_limited", "上传过于频繁 / Too many uploads");
  const mime = baseMime(input.mime);
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw new HttpError(415, "unsupported_type", "不支持的音频格式 / Unsupported audio format");
  if (input.bytes.length === 0) throw new HttpError(400, "empty", "录音为空 / Empty recording");
  if (input.bytes.length > config.maxRecordingBytes) throw new HttpError(413, "too_large", "录音文件过大 / Recording too large");
  if (!looksLikeAudio(input.bytes, mime)) throw new HttpError(415, "not_audio", "文件不是有效音频 / Not a valid audio file");
  const duration = Math.round(Number(input.duration_seconds) || 0);
  if (duration < 0 || duration > config.maxRecordingSeconds) throw new HttpError(400, "too_long", "录音超过时长上限 / Recording exceeds the duration limit");

  const d = db();
  const ans = d.prepare("SELECT * FROM answers WHERE attempt_id = ? AND question_code = ?").get(a.id, questionCode) as AnswerRow | undefined;
  if (!ans) throw new HttpError(404, "not_found", "题目不存在 / Question not found");
  const count = (d.prepare("SELECT COUNT(*) AS n FROM recordings WHERE answer_id = ?").get(ans.id) as { n: number }).n;
  if (count >= config.maxRecordingsPerAnswer) throw new HttpError(429, "too_many", "本题录音次数已达上限 / Recording limit reached for this question");

  const recId = id("rec");
  const rel = storagePathFor(a.id, recId, ext);
  const abs = absolute(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, input.bytes, { mode: 0o600 });

  d.transaction(() => {
    for (const old of d.prepare("SELECT * FROM recordings WHERE answer_id = ? AND deleted_at IS NULL").all(ans.id) as RecordingRow[]) removeFile(old);
    d.prepare("UPDATE recordings SET deleted_at = ? WHERE answer_id = ? AND deleted_at IS NULL").run(now(), ans.id);
    d.prepare(
      "INSERT INTO recordings (id, answer_id, attempt_id, storage_path, mime_type, bytes, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(recId, ans.id, a.id, rel, mime, input.bytes.length, duration, now());
    // A new take invalidates the old machine transcript; the candidate's corrected text is kept as-is.
    d.prepare("UPDATE answers SET recording_duration_seconds = ?, machine_transcript = NULL, transcript_provider = NULL, saved_at = ? WHERE id = ?").run(duration, now(), ans.id);
  })();
  logEvent(a.id, "recording_uploaded", questionCode, { seconds: duration, bytes: input.bytes.length });
  return getRecording(recId)!;
}

function removeFile(r: RecordingRow) {
  try {
    fs.rmSync(absolute(r.storage_path), { force: true });
  } catch {
    /* already gone */
  }
}

export function getRecording(recId: string): RecordingRow | undefined {
  return db().prepare("SELECT * FROM recordings WHERE id = ?").get(recId) as RecordingRow | undefined;
}

/** Candidate deletes their take before submitting ("删除重录"). The file is removed immediately. */
export function deleteRecording(actor: Actor, recId: string) {
  const r = getRecording(recId);
  if (!r || r.deleted_at) throw new HttpError(404, "not_found", "未找到 / Not found");
  const a = ownAttempt(actor, r.attempt_id);
  if (!isEditable(a)) throw new HttpError(409, "locked", "答案已锁定 / Answers are locked");
  removeFile(r);
  const d = db();
  d.prepare("UPDATE recordings SET deleted_at = ? WHERE id = ?").run(now(), r.id);
  d.prepare("UPDATE answers SET recording_duration_seconds = 0, machine_transcript = NULL, transcript_provider = NULL WHERE id = ?").run(r.answer_id);
  logEvent(a.id, "recording_deleted");
}

// ---------- signed, short-lived media URLs ----------
function mediaSig(recId: string, userId: string, exp: number, download: boolean) {
  return crypto.createHmac("sha256", config.sessionSecret).update(`media|${recId}|${userId}|${exp}|${download ? 1 : 0}`).digest("base64url");
}

/** URL bound to one recording, one user and a 5-minute window. The media route also requires that user's session. */
export function signedMediaUrl(recId: string, userId: string, opts: { download?: boolean } = {}) {
  const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSeconds;
  const dl = !!opts.download;
  return `/api/media/${recId}?exp=${exp}${dl ? "&dl=1" : ""}&sig=${mediaSig(recId, userId, exp, dl)}`;
}

/** Validates signature + expiry + session ownership/role. Returns the file to stream. */
export function authorizeMedia(actor: Actor, recId: string, params: { exp: string | null; sig: string | null; dl: boolean; log?: boolean }) {
  const exp = Number(params.exp);
  if (!params.sig || !Number.isFinite(exp) || exp < Date.now() / 1000) throw new HttpError(403, "expired", "链接已过期 / Link expired");
  const expected = Buffer.from(mediaSig(recId, actor.id, exp, params.dl));
  const got = Buffer.from(params.sig);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) throw new HttpError(403, "bad_signature", "链接无效 / Invalid link");
  const r = getRecording(recId);
  if (!r || r.deleted_at) throw new HttpError(404, "not_found", "Not found");
  if (isAdmin(actor)) {
    adminAttempt(actor, r.attempt_id);
    if (params.log !== false) audit(actor, params.dl ? "download_recording" : "play_recording", "recording", r.id, { attempt: r.attempt_id });
  } else {
    ownAttempt(actor, r.attempt_id);
    if (params.dl) throw new HttpError(403, "forbidden", "Forbidden");
  }
  const abs = absolute(r.storage_path);
  if (!fs.existsSync(abs)) throw new HttpError(404, "not_found", "Not found");
  return { path: abs, mime: r.mime_type, bytes: r.bytes, recording: r };
}

// ---------- transcription (async, provider adapter) ----------
const inflight = new Set<string>();

export function queueTranscription(actor: Actor, recId: string): RecordingRow {
  const r = getRecording(recId);
  if (!r || r.deleted_at) throw new HttpError(404, "not_found", "未找到 / Not found");
  if (isAdmin(actor)) adminAttempt(actor, r.attempt_id);
  else {
    const a = ownAttempt(actor, r.attempt_id);
    if (!isEditable(a)) throw new HttpError(409, "locked", "答案已锁定 / Answers are locked");
  }
  if (!rateLimit(`stt:${r.attempt_id}`, 40, 3600)) throw new HttpError(429, "rate_limited", "请求过于频繁 / Too many requests");
  if (r.transcription_status === "queued" || r.transcription_status === "processing") return r;
  db().prepare("UPDATE recordings SET transcription_status = 'queued', transcription_error = NULL WHERE id = ?").run(r.id);
  setImmediate(() => void runTranscription(r.id));
  return getRecording(r.id)!;
}

/** Runs one job with up to 3 attempts. Exported for tests. */
export async function runTranscription(recId: string) {
  if (inflight.has(recId)) return;
  inflight.add(recId);
  const d = db();
  try {
    const r = getRecording(recId);
    if (!r || r.deleted_at) return;
    d.prepare("UPDATE recordings SET transcription_status = 'processing' WHERE id = ?").run(r.id);
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const bytes = fs.readFileSync(absolute(r.storage_path));
        const out = await transcribeAudio(bytes, r.mime_type);
        if (out.status === "unavailable") {
          d.prepare("UPDATE recordings SET transcription_status = 'unavailable', transcription_error = ? WHERE id = ?").run(out.reason, r.id);
          return;
        }
        const still = getRecording(r.id);
        if (!still || still.deleted_at) return; // re-recorded while we were working
        d.transaction(() => {
          d.prepare("UPDATE recordings SET transcription_status = 'done', transcription_error = NULL WHERE id = ?").run(r.id);
          // Keep the machine transcript separate; seed the editable copy only if the candidate hasn't written one.
          d.prepare(
            "UPDATE answers SET machine_transcript = ?, transcript_provider = ?, corrected_transcript = COALESCE(NULLIF(corrected_transcript, ''), ?) WHERE id = ?",
          ).run(out.text, out.provider, out.text, r.answer_id);
        })();
        logEvent(r.attempt_id, "transcribed", null, { provider: out.provider });
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message.slice(0, 300) : String(e);
        if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 1500));
      }
    }
    d.prepare("UPDATE recordings SET transcription_status = 'failed', transcription_error = ? WHERE id = ?").run(lastErr, r.id);
  } finally {
    inflight.delete(recId);
  }
}

/** Delete recordings older than `days` (retention policy). */
export function purgeRecordingsOlderThan(admin: Actor, days: number) {
  if (admin.role !== "super_admin") throw new HttpError(403, "forbidden", "仅超级管理员 / Super admin only");
  if (!(days >= 1)) throw new HttpError(400, "invalid", "Invalid days");
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const d = db();
  const rows = d.prepare("SELECT * FROM recordings WHERE deleted_at IS NULL AND created_at < ?").all(cutoff) as RecordingRow[];
  for (const r of rows) removeFile(r);
  d.prepare("UPDATE recordings SET deleted_at = ? WHERE deleted_at IS NULL AND created_at < ?").run(now(), cutoff);
  audit(admin, "purge_recordings", "recording", null, { days, count: rows.length });
  return rows.length;
}
