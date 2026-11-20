"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtHMS, fmtMS, tr, type Lang } from "@/lib/i18n";
import { SCORE_LABELS } from "@/lib/questions";
import type { ScoreSummary } from "@/lib/scoring";
import { bandLabel } from "@/lib/labels";

// Score updates flow from QuestionReview to the summary panel through a window event (no shared store needed).
const SCORE_EVENT = "sfa:score";

interface ReviewData {
  question: { code: string; category: string; order: number; prompt_zh: string; prompt_en: string; rubric_zh: string; rubric_en: string; soft_limit_seconds: number };
  answer: { typed_text: string; machine_transcript: string | null; corrected_transcript: string | null; transcript_provider: string | null; active_duration_seconds: number; recording_duration_seconds: number; first_opened_at: string | null; last_left_at: string | null; saved_at: string | null };
  answered: boolean;
  recording: { id: string; mime_type: string; bytes: number; duration_seconds: number; created_at: string; transcription_status: string; transcription_error: string | null; play_url: string; download_url: string } | null;
  myReview: { score: number | null; private_notes: string } | null;
  otherReviews: { reviewer_name: string; score: number | null; private_notes: string }[];
  events: number;
}

export function QuestionReview({ lang, attemptId, data, categoryName }: { lang: Lang; attemptId: string; data: ReviewData; categoryName: string }) {
  const t = tr(lang);
  const q = data.question;
  const [score, setScore] = useState<number | null>(data.myReview?.score ?? null);
  const [notes, setNotes] = useState(data.myReview?.private_notes ?? "");
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [err, setErr] = useState("");
  const [playUrl, setPlayUrl] = useState(data.recording?.play_url ?? null);
  const [transcript, setTranscript] = useState(data.answer.machine_transcript);
  const [stt, setStt] = useState(data.recording?.transcription_status ?? "none");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persist(next: { score?: number | null; notes?: string }) {
    setState("saving");
    setErr("");
    try {
      const r = await api<{ score: ScoreSummary; band: string | null }>("/api/admin/reviews", {
        body: { attempt_id: attemptId, question_code: q.code, score: next.score !== undefined ? next.score : score, private_notes: next.notes !== undefined ? next.notes : notes },
      });
      window.dispatchEvent(new CustomEvent(SCORE_EVENT, { detail: r }));
      setState("saved");
    } catch (e) {
      setState("error");
      setErr((e as Error).message);
    }
  }

  // Signed URLs expire after 5 minutes; refresh before play if the page has been open a while.
  async function refreshUrl() {
    if (!data.recording) return;
    try {
      const r = await api<{ play_url: string }>(`/api/recordings/${data.recording.id}`);
      setPlayUrl(r.play_url);
    } catch {
      /* keep the old one */
    }
  }

  async function adminTranscribe() {
    if (!data.recording) return;
    try {
      await api(`/api/recordings/${data.recording.id}/transcribe`, { method: "POST" });
      setStt("queued");
      const poll = async () => {
        const r = await api<{ transcription_status: string; machine_transcript: string | null }>(`/api/recordings/${data.recording!.id}`);
        setStt(r.transcription_status);
        if (r.transcription_status === "done") setTranscript(r.machine_transcript);
        else if (r.transcription_status === "queued" || r.transcription_status === "processing") setTimeout(poll, 2000);
      };
      setTimeout(poll, 1500);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const overSoft = data.answer.active_duration_seconds > q.soft_limit_seconds;
  const corrected = data.answer.corrected_transcript?.trim();
  const edited = corrected && transcript && corrected !== transcript.trim();

  return (
    <section className="card p-5 sm:p-6" id={q.code} aria-labelledby={`q-${q.code}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-mute">
        <span className="num font-semibold text-ink">{q.code}</span>
        <span>{categoryName}</span>
        <span className="ml-auto num">{t("用时", "Time")} <span className={overSoft ? "text-watch" : ""}>{fmtHMS(data.answer.active_duration_seconds)}</span></span>
        {data.events ? <span className="tag tag-watch">{t(`事件 ${data.events}`, `${data.events} events`)}</span> : null}
      </div>
      <h2 id={`q-${q.code}`} className="mt-2 text-lg font-semibold">{lang === "en" ? q.prompt_en : q.prompt_zh}</h2>
      <p className="mt-1 text-sm text-mute">{t("优秀回答应体现：", "Strong answers show: ")}{lang === "en" ? q.rubric_en : q.rubric_zh}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="label">{t("文字回答", "Written answer")}</div>
          {data.answer.typed_text.trim() ? (
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper p-3 text-[0.95rem]">{data.answer.typed_text}</p>
          ) : (
            <p className="mt-1 text-sm text-faint">{t("无", "None")}</p>
          )}
        </div>
        <div className="min-w-0">
          <div className="label">{t("录音", "Recording")}</div>
          {data.recording && playUrl ? (
            <>
              <audio className="mt-1 w-full" controls preload="none" src={playUrl} onPlay={(e) => {
                // If the signed URL has expired, swap in a fresh one and resume.
                const el = e.currentTarget;
                const exp = Number(new URL(playUrl, location.href).searchParams.get("exp"));
                if (exp * 1000 < Date.now() + 10_000) { el.pause(); void refreshUrl().then(() => setTimeout(() => el.play().catch(() => {}), 50)); }
              }} />
              <p className="mt-1 text-xs text-mute">
                {fmtMS(data.recording.duration_seconds)}，{(data.recording.bytes / 1024).toFixed(0)} KB，{data.recording.mime_type}，{fmtDate(data.recording.created_at, lang)}
                {" "}<a className="underline" href={data.recording.download_url} onClick={() => setTimeout(refreshUrl, 500)}>{t("下载（会记录）", "Download (logged)")}</a>
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-faint">{t("无", "None")}</p>
          )}
          {data.recording ? (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="label">{t("机器转写（原始）", "Machine transcript (raw)")}</span>
                {data.answer.transcript_provider ? <span className="text-xs text-faint">{data.answer.transcript_provider}</span> : null}
                {stt !== "done" ? (
                  <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={adminTranscribe} disabled={stt === "queued" || stt === "processing"}>
                    {stt === "queued" || stt === "processing" ? t("转写中…", "Transcribing…") : t("转写", "Transcribe")}
                  </button>
                ) : null}
              </div>
              {transcript ? <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper p-3 text-[0.95rem] text-ink-2">{transcript}</p> : <p className="mt-1 text-sm text-faint">{stt === "failed" || stt === "unavailable" ? data.recording.transcription_error : t("尚未转写", "Not transcribed")}</p>}
            </div>
          ) : null}
          {corrected ? (
            <div className="mt-3">
              <div className="label">{t("候选人修改后的转写", "Candidate-corrected transcript")} {edited ? <span className="tag tag-signal ml-1">{t("已修改", "Edited")}</span> : null}</div>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper p-3 text-[0.95rem]">{data.answer.corrected_transcript}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 border-t border-rule pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-medium">{t("您的评分", "Your score")}</span>
          <div className="flex gap-1" role="radiogroup" aria-label={t(`${q.code} 评分`, `${q.code} score`)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={score === n}
                title={SCORE_LABELS[lang][n as 1 | 2 | 3 | 4 | 5]}
                onClick={() => { const v = score === n ? null : n; setScore(v); void persist({ score: v }); }}
                className={`num h-9 w-9 rounded-md border text-sm font-semibold ${score === n ? "border-signal bg-signal text-sheet" : "border-rule-strong bg-sheet hover:border-ink-2"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-sm text-mute">{score ? SCORE_LABELS[lang][score as 1 | 2 | 3 | 4 | 5] : t("未评分", "Not scored")}</span>
          <span className={`ml-auto text-sm ${state === "error" ? "text-risk" : "text-mute"}`} role="status">
            {state === "saving" ? t("保存中…", "Saving…") : state === "saved" ? t("已保存", "Saved") : state === "error" ? err : ""}
          </span>
        </div>
        <label className="mt-3 block">
          <span className="label">{t("私人笔记（仅管理员可见）", "Private notes (admins only)")}</span>
          <textarea
            className="field mt-1 min-h-[64px]"
            value={notes}
            maxLength={5000}
            onChange={(e) => {
              const v = e.target.value;
              setNotes(v);
              if (notesTimer.current) clearTimeout(notesTimer.current);
              notesTimer.current = setTimeout(() => void persist({ notes: v }), 900);
            }}
          />
        </label>
        {data.otherReviews.length ? (
          <ul className="mt-3 space-y-1 text-sm text-ink-2">
            {data.otherReviews.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{r.reviewer_name}</span>: <span className="num">{r.score ?? "—"}</span>
                {r.private_notes ? <span className="text-mute">，{r.private_notes}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export function ScoreSummaryPanel({ lang, initial, band, categories, reviewers }: { lang: Lang; initial: ScoreSummary; band: string | null; categories: { code: string; name_zh: string; name_en: string; weight: number }[]; reviewers: string[] }) {
  const t = tr(lang);
  const [s, setS] = useState(initial);
  const [b, setB] = useState(band);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ score: ScoreSummary; band: string | null }>).detail;
      setS(d.score);
      setB(d.band);
    };
    window.addEventListener(SCORE_EVENT, on);
    return () => window.removeEventListener(SCORE_EVENT, on);
  }, []);
  const bl = bandLabel(lang, b);
  const shown = s.final ?? s.provisional;
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{t("综合评分", "Overall score")}</h2>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="num text-4xl font-semibold">{shown === null ? "—" : shown.toFixed(1)}</span>
        <span className="text-sm text-mute">{s.final !== null ? t(`最终（${s.totalQuestions}题已评）`, `Final (all ${s.totalQuestions} scored)`) : t(`暂定，已评 ${s.scoredQuestions}/${s.totalQuestions}`, `Provisional, ${s.scoredQuestions}/${s.totalQuestions} scored`)}</span>
      </div>
      {bl ? <span className={`tag ${bl[1]} mt-2`}>{bl[0]}</span> : null}
      <div className="mt-4 space-y-3">
        {s.categories.map((c) => {
          const cat = categories.find((x) => x.code === c.code)!;
          return (
            <div key={c.code}>
              <div className="flex justify-between text-sm">
                <span>{c.code}. {lang === "en" ? cat.name_en : cat.name_zh}</span>
                <span className="num text-mute">{c.points === null ? "—" : c.points.toFixed(1)} / {c.weight}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-paper" aria-hidden="true">
                <div className="h-full origin-left bg-signal" style={{ transform: `scaleX(${c.points === null ? 0 : c.points / c.weight})` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-mute">
        {t("类别得分 = 该类平均分 / 5 × 权重。多位评审时取平均。", "Category = mean score / 5 × weight. Multiple reviewers are averaged.")}
        {reviewers.length ? ` ${t("评审：", "Reviewers: ")}${reviewers.join("、")}${t("。", ".")}` : ""}
        {reviewers.length < 2 ? ` ${t("建议录用决定前由第二位评审复核。", "Consider a second reviewer before a hiring decision.")}` : ""}
      </p>
    </section>
  );
}

interface Accommodation { id: string; kind: string; message: string; status: string; created_at: string }

export function AttemptActions(p: { lang: Lang; attemptId: string; status: string; archived: boolean; hasDeadline: boolean; pasteRestricted: boolean; pasteAllowed: boolean; accommodations: Accommodation[] }) {
  const t = tr(p.lang);
  const [mode, setMode] = useState<"" | "reopen" | "extend">("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/admin/attempts/${p.attemptId}`, { body });
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const open = p.status === "in_progress" || p.status === "reopened";
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{t("操作", "Actions")}</h2>
      {p.accommodations.length ? (
        <div className="mt-3 space-y-2">
          {p.accommodations.map((a) => (
            <div key={a.id} className="rounded-md border border-rule p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.kind === "paste" ? t("申请允许粘贴", "Paste request") : a.kind === "time" ? t("申请延长时间", "Extra time request") : t("便利安排申请", "Accommodation request")}</span>
                <span className={`tag ml-auto ${a.status === "open" ? "tag-watch" : a.status === "granted" ? "tag-good" : ""}`}>{a.status === "open" ? t("待处理", "Open") : a.status === "granted" ? t("已批准", "Granted") : t("已拒绝", "Declined")}</span>
              </div>
              <p className="mt-1 text-ink-2">{a.message}</p>
              {a.status === "open" ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => act(a.kind === "paste" ? { action: "paste", allowed: true, request_id: a.id } : { action: "resolve_accommodation", request_id: a.id, status: "granted" })}>{t("批准", "Grant")}</button>
                  <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => act({ action: "resolve_accommodation", request_id: a.id, status: "declined" })}>{t("拒绝", "Decline")}</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {!open ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMode("reopen")}>{t("重新开放", "Reopen")}</button> : null}
        {p.hasDeadline && p.status !== "submitted" ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMode("extend")}>{t("延长时间", "Extend time")}</button> : null}
        {p.pasteRestricted ? (
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => act({ action: "paste", allowed: !p.pasteAllowed })}>
            {p.pasteAllowed ? t("关闭粘贴便利", "Revoke paste") : t("允许该候选人粘贴", "Allow paste")}
          </button>
        ) : null}
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => act({ action: p.archived ? "unarchive" : "archive" })}>{p.archived ? t("取消归档", "Unarchive") : t("归档", "Archive")}</button>
      </div>
      {mode ? (
        <div className="mt-4 space-y-3 border-t border-rule pt-4">
          {mode === "extend" || mode === "reopen" ? (
            <label className="block">
              <span className="label">{mode === "extend" ? t("延长分钟数", "Minutes to add") : t("额外时间（分钟，可为0）", "Extra minutes (may be 0)")}</span>
              <input className="field mt-1" type="number" min={mode === "extend" ? 1 : 0} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </label>
          ) : null}
          <label className="block">
            <span className="label">{t("原因（必填，记入审计日志）", "Reason (required, audited)")}</span>
            <input className="field mt-1" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMode("")}>{t("取消", "Cancel")}</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !reason.trim()} onClick={() => act(mode === "extend" ? { action: "extend", minutes, reason } : { action: "reopen", reason, extend_minutes: minutes })}>
              {t("确认", "Confirm")}
            </button>
          </div>
        </div>
      ) : null}
      {err ? <p className="mt-2 text-sm text-risk" role="alert">{err}</p> : null}
    </section>
  );
}
