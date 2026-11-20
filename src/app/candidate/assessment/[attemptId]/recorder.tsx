"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtMS, tr, type Lang } from "@/lib/i18n";
import type { CandidateRecording } from "@/lib/view-types";

type RecState = "idle" | "requesting" | "recording" | "paused" | "uploading" | "uploaded" | "upload_failed";

const MAX_SECONDS = 15 * 60;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

interface Props {
  lang: Lang;
  attemptId: string;
  questionCode: string;
  consent: boolean;
  sttEnabled: boolean;
  disabled: boolean;
  recording: CandidateRecording | null;
  machineTranscript: string | null;
  transcript: string;
  onTranscriptChange: (v: string) => void;
  onPasteBlocked: (e: React.ClipboardEvent | React.DragEvent) => void;
  /** (recording, machineTranscript, correctedTranscript, rev) */
  onRecordingChange: (rec: CandidateRecording | null, machine?: string | null, corrected?: string | null, rev?: number) => void;
  onEvent: (type: string, meta?: Record<string, unknown>) => void;
}

export function Recorder(p: Props) {
  const t = tr(p.lang);
  const [state, setState] = useState<RecState>(p.recording ? "uploaded" : "idle");
  const [seconds, setSeconds] = useState(p.recording?.duration_seconds ?? 0);
  const [err, setErr] = useState("");
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [stt, setStt] = useState(p.recording?.transcription_status ?? "none");
  const [sttErr, setSttErr] = useState(p.recording?.transcription_error ?? "");
  const [level, setLevel] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const accRef = useRef(0); // accumulated ms excluding pauses
  const segStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failedBlobRef = useRef<{ blob: Blob; seconds: number } | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  // Fetch a fresh signed playback URL for an existing take.
  useEffect(() => {
    if (!p.recording) return;
    let live = true;
    api<{ play_url: string; transcription_status: string }>(`/api/recordings/${p.recording.id}`)
      .then((r) => {
        if (!live) return;
        setPlayUrl(r.play_url);
        if (r.transcription_status === "queued" || r.transcription_status === "processing") poll(p.recording!.id);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.recording?.id]);

  useEffect(
    () => () => {
      stopTracks();
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearTimeout(pollRef.current);
      if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    },
    [],
  );

  const elapsedMs = () => accRef.current + (segStartRef.current !== null ? performance.now() - segStartRef.current : 0);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.raf);
      void meterRef.current.ctx.close();
      meterRef.current = null;
    }
  }

  async function start() {
    setErr("");
    if (!supported) {
      setErr(t("此浏览器不支持录音，请打字作答或更换浏览器（推荐最新版 Chrome、Edge 或 Safari）。", "This browser can't record. Type your answer, or switch to a current Chrome, Edge or Safari."));
      p.onEvent("mic_unsupported");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => void finish();
      rec.onerror = () => {
        p.onEvent("recording_error");
        setErr(t("录音中断，已保留中断前的内容。", "Recording was interrupted; what you recorded so far is kept."));
      };
      // Mic unplugged / permission revoked mid-recording: stop and keep what we have.
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (rec.state !== "inactive") {
          p.onEvent("recording_error", { reason: "track_ended" });
          setErr(t("麦克风已断开，已保留断开前的录音。", "The microphone disconnected; the recording up to that point is kept."));
          rec.stop();
        }
      });
      rec.start(1000); // 1s slices so an interruption loses at most a second
      mediaRef.current = rec;
      accRef.current = 0;
      segStartRef.current = performance.now();
      setSeconds(0);
      setState("recording");
      p.onEvent("recording_started");
      timerRef.current = setInterval(() => {
        const s = Math.floor(elapsedMs() / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
      try {
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          meterRef.current!.raf = requestAnimationFrame(loop);
        };
        meterRef.current = { ctx, raf: requestAnimationFrame(loop) };
      } catch {
        /* level meter is optional */
      }
    } catch (e) {
      stopTracks();
      setState(p.recording ? "uploaded" : "idle");
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      p.onEvent(denied ? "mic_denied" : "recording_error");
      setErr(
        denied
          ? t("麦克风权限被拒绝。您仍可打字作答；如需录音，请在浏览器地址栏中允许麦克风后重试。", "Microphone permission was denied. You can still type; to record, allow the microphone in your browser's address bar and try again.")
          : t("无法打开麦克风，请检查设备后重试。", "Couldn't open the microphone. Check your device and try again."),
      );
    }
  }

  function pauseResume() {
    const rec = mediaRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      accRef.current += performance.now() - (segStartRef.current ?? performance.now());
      segStartRef.current = null;
      setState("paused");
    } else if (rec.state === "paused") {
      rec.resume();
      segStartRef.current = performance.now();
      setState("recording");
    }
  }

  function stop() {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function finish() {
    if (timerRef.current) clearInterval(timerRef.current);
    const secs = Math.max(1, Math.round(elapsedMs() / 1000));
    segStartRef.current = null;
    stopTracks();
    const type = mediaRef.current?.mimeType || chunksRef.current[0]?.type || "audio/webm";
    const blob = new Blob(chunksRef.current, { type });
    mediaRef.current = null;
    p.onEvent("recording_stopped", { seconds: secs });
    if (!blob.size) {
      setState(p.recording ? "uploaded" : "idle");
      setErr(t("没有录到声音，请重试。", "Nothing was recorded. Please try again."));
      return;
    }
    setSeconds(secs);
    setPlayUrl(URL.createObjectURL(blob));
    await upload(blob, secs);
  }

  async function upload(blob: Blob, secs: number) {
    setState("uploading");
    setErr("");
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fd = new FormData();
        fd.append("file", blob, "answer");
        fd.append("question_code", p.questionCode);
        fd.append("duration_seconds", String(secs));
        const res = await fetch(`/api/attempts/${p.attemptId}/recordings`, { method: "POST", body: fd, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 4xx (validation/locked) won't succeed on retry.
          if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), { fatal: true });
          throw new Error(data.message ?? `HTTP ${res.status}`);
        }
        failedBlobRef.current = null;
        const rec: CandidateRecording = { id: data.id, duration_seconds: data.duration_seconds, mime_type: data.mime_type, transcription_status: "none", transcription_error: null };
        setStt("none");
        setSttErr("");
        p.onRecordingChange(rec, null);
        setState("uploaded");
        return;
      } catch (e) {
        if ((e as { fatal?: boolean }).fatal || attempt === 3) {
          failedBlobRef.current = { blob, seconds: secs };
          setState("upload_failed");
          setErr(`${t("上传失败：", "Upload failed: ")}${(e as Error).message}`);
          return;
        }
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }

  async function remove() {
    if (!p.recording) {
      setState("idle");
      setPlayUrl(null);
      failedBlobRef.current = null;
      return;
    }
    if (!confirm(t("删除这段录音并重新录制？", "Delete this recording and record again?"))) return;
    try {
      await api(`/api/recordings/${p.recording.id}`, { method: "DELETE" });
      p.onRecordingChange(null, null);
      setPlayUrl(null);
      setSeconds(0);
      setStt("none");
      setState("idle");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function poll(recId: string) {
    if (pollRef.current) clearTimeout(pollRef.current);
    const run = async () => {
      try {
        const r = await api<{ transcription_status: CandidateRecording["transcription_status"]; transcription_error: string | null; machine_transcript: string | null; corrected_transcript: string | null; rev: number }>(`/api/recordings/${recId}`);
        setStt(r.transcription_status);
        setSttErr(r.transcription_error ?? "");
        if (r.transcription_status === "done") {
          p.onRecordingChange({ ...(p.recording as CandidateRecording), id: recId, transcription_status: "done" }, r.machine_transcript, r.corrected_transcript, r.rev);
          return;
        }
        if (r.transcription_status === "queued" || r.transcription_status === "processing") pollRef.current = setTimeout(run, 2000);
      } catch {
        pollRef.current = setTimeout(run, 4000);
      }
    };
    pollRef.current = setTimeout(run, 1500);
  }

  async function transcribe() {
    if (!p.recording) return;
    setSttErr("");
    try {
      const r = await api<{ transcription_status: CandidateRecording["transcription_status"] }>(`/api/recordings/${p.recording.id}/transcribe`, { method: "POST" });
      setStt(r.transcription_status);
      poll(p.recording.id);
    } catch (e) {
      setSttErr((e as Error).message);
    }
  }

  if (!p.consent) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-rule-strong p-4 text-sm text-mute">
        <span className="min-w-0 flex-1">{t("您尚未同意录音，目前仅可打字作答。录音将保存在私有存储中，仅授权招聘人员可收听。", "You haven't consented to recording, so you can only type for now. Recordings are kept in private storage and only authorized recruiters can play them.")}</span>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={p.disabled}
          onClick={async () => {
            if (!confirm(t("确认同意录制并存储您的语音回答？", "Consent to recording and storing your spoken answers?"))) return;
            try {
              await api(`/api/attempts/${p.attemptId}/consent`, { method: "POST" });
              window.location.reload();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          {t("同意录音", "Allow recording")}
        </button>
        {err ? <p className="w-full text-risk">{err}</p> : null}
      </div>
    );
  }

  const busy = state === "recording" || state === "paused";
  const sttBusy = stt === "queued" || stt === "processing";
  const hasTake = !!p.recording || state === "upload_failed";

  return (
    <div className="mt-6 rounded-[var(--radius-md)] border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-medium">{t("语音回答", "Spoken answer")}</span>
        {!busy ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={start} disabled={p.disabled || state === "requesting" || state === "uploading" || hasTake}>
            {state === "requesting" ? t("请求麦克风…", "Requesting mic…") : t("开始录音", "Start recording")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-quiet btn-sm" onClick={pauseResume}>{state === "paused" ? t("继续", "Resume") : t("暂停", "Pause")}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={stop}>{t("停止", "Stop")}</button>
          </>
        )}
        {hasTake && !busy ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={p.disabled || state === "uploading"}>
            {t("删除重录", "Delete and re-record")}
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-sm" aria-live="polite">
          {state === "recording" ? <span className="rec-pulse inline-block h-2.5 w-2.5 rounded-full bg-risk" aria-hidden="true" /> : null}
          <span className="text-mute">{state === "recording" ? t("录音中", "Recording") : state === "paused" ? t("已暂停", "Paused") : state === "uploading" ? t("上传中…", "Uploading…") : state === "uploaded" ? t("已上传", "Uploaded") : t("录音", "Length")}</span>
          <span className="num font-semibold">{fmtMS(seconds)}</span>
        </span>
      </div>

      {state === "recording" ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded bg-sheet" aria-hidden="true">
          <div className="h-full origin-left bg-risk" style={{ transform: `scaleX(${level})` }} />
        </div>
      ) : null}

      {playUrl && !busy ? <audio className="mt-3 w-full" controls preload="metadata" src={playUrl} aria-label={t("播放录音", "Play recording")} /> : null}

      {state === "upload_failed" ? (
        <button type="button" className="btn btn-quiet btn-sm mt-3" onClick={() => failedBlobRef.current && upload(failedBlobRef.current.blob, failedBlobRef.current.seconds)}>
          {t("重试上传", "Retry upload")}
        </button>
      ) : null}

      {err ? <p className="mt-2 text-sm text-risk" role="alert">{err}</p> : null}

      {p.recording ? (
        <div className="mt-4 border-t border-rule pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {p.sttEnabled ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={transcribe} disabled={p.disabled || sttBusy}>
                {sttBusy ? t("转写中…", "Transcribing…") : stt === "done" ? t("重新转写", "Transcribe again") : t("语音转文字", "Transcribe")}
              </button>
            ) : (
              <span className="text-sm text-mute">{t("未启用自动转写，招聘方将直接收听录音。", "Automatic transcription is off; the recruiter will listen to the recording.")}</span>
            )}
            {stt === "failed" || stt === "unavailable" ? <span className="text-sm text-risk">{t("转写失败：", "Transcription failed: ")}{sttErr}</span> : null}
          </div>
          {p.machineTranscript ? (
            <div className="mt-3">
              <div className="label">{t("机器转写（自动生成，仅供参考）", "Machine transcript (auto-generated)")}</div>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-sheet p-3 text-[0.95rem] text-ink-2">{p.machineTranscript}</p>
            </div>
          ) : null}
          {p.machineTranscript || p.transcript ? (
            <label className="mt-3 block">
              <span className="label">{t("您确认/修改后的转写（评审将同时看到原始录音）", "Your corrected transcript (reviewers also hear the original audio)")}</span>
              <textarea
                className="field mt-1 min-h-[110px] resize-y"
                value={p.transcript}
                onChange={(e) => p.onTranscriptChange(e.target.value)}
                onPaste={p.onPasteBlocked}
                onDrop={p.onPasteBlocked}
                maxLength={20000}
                disabled={p.disabled}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
