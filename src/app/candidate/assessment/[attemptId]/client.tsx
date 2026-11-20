"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { fmtHMS, tr, type Lang } from "@/lib/i18n";
import type { CandidateAnswer, CandidateViewData } from "@/lib/view-types";
import { Recorder } from "./recorder";
import { LangToggle } from "@/components/lang-toggle";
import { Wordmark } from "@/components/wordmark";

type SaveState = "saved" | "saving" | "dirty" | "offline" | "error" | "locked";

interface LocalAnswer {
  text: string;
  transcript: string;
  rev: number;
  /** Rev of the last text the server acknowledged. */
  savedRev: number;
  serverActive: number;
}

const AUTOSAVE_MS = 10_000;

export function AssessmentClient({ lang, initial, candidateName, sttEnabled }: { lang: Lang; initial: CandidateViewData; candidateName: string; sttEnabled: boolean }) {
  const t = tr(lang);
  const view = initial;
  const attemptId = view.attempt.id;
  const qs = view.questions;
  const [answersMeta, setAnswersMeta] = useState<Record<string, CandidateAnswer>>(() => Object.fromEntries(view.answers.map((a) => [a.question_code, a])));
  const localRef = useRef<Record<string, LocalAnswer>>(
    Object.fromEntries(
      view.answers.map((a) => [a.question_code, { text: a.typed_text, transcript: a.corrected_transcript ?? "", rev: a.rev, savedRev: a.rev, serverActive: a.active_duration_seconds }]),
    ),
  );
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const startIdx = Math.max(0, qs.findIndex((q) => q.code === view.attempt.current_question_code));
  const [idx, setIdx] = useState(startIdx);
  const q = qs[idx];
  const curCodeRef = useRef(q.code);

  // ---- server-aligned monotonic clock (immune to device clock changes) ----
  const clockRef = useRef({ server: Date.parse(view.server_now), perf: typeof performance !== "undefined" ? performance.now() : 0 });
  const serverNow = useCallback(() => clockRef.current.server + (performance.now() - clockRef.current.perf), []);
  const syncClock = (iso: string) => {
    clockRef.current = { server: Date.parse(iso), perf: performance.now() };
  };
  const [tick, setTick] = useState(0);

  // ---- active-time accounting ----
  const unsentRef = useRef(0); // seconds accumulated for the current question, not yet sent
  const pendingRef = useRef<{ seq: number; delta: number; code: string } | null>(null);
  const seqRef = useRef(view.attempt.heartbeat_seq);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const inflightRef = useRef(false);

  // events (integrity + activity), batched
  const evQueue = useRef<{ type: string; question_code?: string | null; meta?: Record<string, unknown> }[]>([]);
  const logEvent = useCallback((type: string, meta?: Record<string, unknown>) => {
    evQueue.current.push({ type, question_code: curCodeRef.current, meta });
  }, []);
  const flushEvents = useCallback((keepalive = false) => {
    if (!evQueue.current.length) return;
    const events = evQueue.current.splice(0, 20);
    void api(`/api/attempts/${attemptId}/events`, { body: { events }, keepalive }).catch(() => {});
  }, [attemptId]);

  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast({ msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const [lockedReason, setLockedReason] = useState<string | null>(null);

  /** Send one autosave/heartbeat for a question. One request in flight at a time; failures are retried with the same seq so time is never double counted. */
  const save = useCallback(
    async (code: string, extra: { opened?: boolean; left?: boolean; keepalive?: boolean } = {}) => {
      if (inflightRef.current && !extra.keepalive) return false;
      const local = localRef.current[code];
      if (!pendingRef.current && unsentRef.current >= 1 && code === curCodeRef.current) {
        const delta = Math.floor(unsentRef.current);
        unsentRef.current -= delta;
        pendingRef.current = { seq: ++seqRef.current, delta, code };
      }
      const pending = pendingRef.current && pendingRef.current.code === code ? pendingRef.current : null;
      const dirty = local.rev > local.savedRev;
      if (!dirty && !pending && !extra.opened && !extra.left) return true;
      const body: Record<string, unknown> = {};
      if (dirty) Object.assign(body, { rev: local.rev, typed_text: local.text, corrected_transcript: local.transcript });
      if (pending) Object.assign(body, { seq: pending.seq, active_delta: pending.delta });
      if (extra.opened) body.opened = true;
      if (extra.left) body.left = true;
      const sentRev = local.rev;
      inflightRef.current = true;
      if (dirty) setSaveState("saving");
      try {
        const r = await api<{ rev: number; saved_at: string | null; active_duration_seconds: number; server_now: string }>(`/api/attempts/${attemptId}/answers/${code}`, {
          method: "PATCH",
          body,
          keepalive: extra.keepalive,
        });
        syncClock(r.server_now);
        local.savedRev = Math.max(local.savedRev, sentRev);
        local.serverActive = r.active_duration_seconds;
        if (pending) pendingRef.current = null;
        setSavedAt(r.saved_at);
        setSaveState(local.rev > local.savedRev ? "dirty" : "saved");
        return true;
      } catch (e) {
        if (e instanceof ApiError && (e.code === "locked" || e.status === 404)) {
          setSaveState("locked");
          setLockedReason(e.message);
        } else setSaveState(navigator.onLine ? "error" : "offline");
        return false;
      } finally {
        inflightRef.current = false;
      }
    },
    [attemptId],
  );

  // 1-second tick: timers + active time (only while the tab is visible).
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") unsentRef.current += 1;
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Autosave every 10s.
  useEffect(() => {
    const iv = setInterval(() => {
      void save(curCodeRef.current);
      flushEvents();
    }, AUTOSAVE_MS);
    return () => clearInterval(iv);
  }, [save, flushEvents]);

  // Mark the first question opened.
  useEffect(() => {
    void save(q.code, { opened: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visibility, connectivity, unload.
  useEffect(() => {
    const onVis = () => {
      logEvent(document.visibilityState === "hidden" ? "visibility_hidden" : "visibility_visible");
      if (document.visibilityState === "hidden") {
        void save(curCodeRef.current, { keepalive: true });
        flushEvents(true);
      }
    };
    const onOnline = () => {
      logEvent("online");
      void save(curCodeRef.current);
    };
    const onOffline = () => {
      logEvent("offline");
      setSaveState("offline");
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      const local = localRef.current[curCodeRef.current];
      void save(curCodeRef.current, { keepalive: true, left: true });
      flushEvents(true);
      if (local.rev > local.savedRev) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [save, flushEvents, logEvent]);

  // ---- deadline ----
  const deadlineMs = view.attempt.deadline_at ? Date.parse(view.attempt.deadline_at) : null;
  const nowMs = serverNow();
  void tick;
  const elapsed = Math.floor((nowMs - Date.parse(view.attempt.started_at)) / 1000);
  const remaining = deadlineMs ? Math.floor((deadlineMs - nowMs) / 1000) : null;
  const warned = useRef<{ ten?: boolean; two?: boolean; done?: boolean }>({});
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 600 && remaining > 120 && !warned.current.ten) {
      warned.current.ten = true;
      showToast(t("距离时间上限还有10分钟。", "10 minutes left before the time cap."));
    }
    if (remaining <= 120 && remaining > 0 && !warned.current.two) {
      warned.current.two = true;
      showToast(t("还剩2分钟，答案会持续自动保存。", "2 minutes left. Answers keep saving automatically."));
    }
    if (remaining <= 0 && !warned.current.done) {
      warned.current.done = true;
      void (async () => {
        await save(curCodeRef.current, { left: true });
        flushEvents();
        window.location.href = view.settings.auto_submit_on_expiry ? `/candidate/submitted?attempt=${attemptId}` : `/candidate/review/${attemptId}`;
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  // ---- navigation ----
  const go = async (to: number) => {
    if (to < 0 || to >= qs.length || to === idx) return;
    if (!view.settings.allow_navigation && to < idx) return;
    const from = curCodeRef.current;
    await save(from, { left: true });
    unsentRef.current = 0;
    curCodeRef.current = qs[to].code;
    setIdx(to);
    void save(qs[to].code, { opened: true });
    window.scrollTo({ top: 0 });
  };

  const toReview = async () => {
    await save(curCodeRef.current, { left: true });
    flushEvents();
    window.location.href = `/candidate/review/${attemptId}`;
  };

  // ---- editing ----
  const local = localRef.current[q.code];
  const meta = answersMeta[q.code];
  const nextRev = () => Math.max(Math.floor(serverNow()), local.rev + 1);
  const onText = (v: string) => {
    local.text = v;
    local.rev = nextRev();
    setSaveState("dirty");
    rerender();
  };
  const onTranscript = (v: string) => {
    local.transcript = v;
    local.rev = nextRev();
    setSaveState("dirty");
    rerender();
  };

  const pasteAllowed = view.attempt.paste_allowed;
  const blockPaste = (e: React.ClipboardEvent | React.DragEvent, kind: "paste_blocked" | "drop_blocked") => {
    if (pasteAllowed) return;
    e.preventDefault();
    logEvent(kind);
    showToast(t("本测评不支持粘贴，请直接输入或录音。", "Pasting is turned off for this assessment. Type or record instead."));
  };
  const blockCopy = (e: React.SyntheticEvent, kind: "copy_blocked" | "cut_blocked" | "contextmenu_blocked") => {
    if (!view.settings.copy_restriction_enabled) return;
    e.preventDefault();
    logEvent(kind);
    showToast(t("题目内容不支持复制。", "Question text can't be copied."));
  };

  const answeredCount = useMemo(
    () => qs.filter((x) => {
      const l = localRef.current[x.code];
      return l.text.trim() || l.transcript.trim() || answersMeta[x.code]?.recording;
    }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answersMeta, tick, idx],
  );

  const qActive = local.serverActive + (pendingRef.current?.code === q.code ? pendingRef.current.delta : 0) + Math.floor(unsentRef.current);
  const overSoft = qActive > q.soft_limit_seconds;
  const cat = view.categories.find((c) => c.code === q.category)!;
  const prompt = lang === "en" ? q.prompt_en : q.prompt_zh;
  const [railOpen, setRailOpen] = useState(false);

  const saveLabel: Record<SaveState, string> = {
    saved: savedAt ? t("已自动保存", "Saved") : t("已同步", "Synced"),
    saving: t("保存中…", "Saving…"),
    dirty: t("有未保存的更改", "Unsaved changes"),
    offline: t("网络断开，恢复后自动重试", "Offline. Will retry when you reconnect"),
    error: t("保存失败，正在重试", "Save failed. Retrying"),
    locked: t("答案已锁定", "Answers locked"),
  };

  return (
    <div className="min-h-dvh">
      {/* Top bar: brand, progress, timers */}
      <header className="sticky top-0 z-20 border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Wordmark href="/candidate" />
          <span className="hidden text-sm text-mute md:inline">{t("机器人供应链负责人测评", "Robotics Supply Chain Lead assessment")}</span>
          <div className="ml-auto flex items-center gap-5 text-sm">
            <div className="text-right">
              <div className="label">{t("总用时", "Total time")}</div>
              <div className="num text-base font-semibold" aria-live="off">{fmtHMS(elapsed)}</div>
            </div>
            {remaining !== null ? (
              <div className="text-right">
                <div className="label">{t("剩余", "Remaining")}</div>
                <div className={`num text-base font-semibold ${remaining <= 600 ? "text-risk" : ""}`}>{fmtHMS(Math.max(0, remaining))}</div>
              </div>
            ) : null}
            <div className="text-right">
              <div className="label">{t("当前题用时", "This question")}</div>
              <div className={`num text-base font-semibold ${overSoft ? "text-watch" : ""}`}>{fmtHMS(qActive)}</div>
            </div>
            <LangToggle lang={lang} />
          </div>
        </div>
        <div className="h-1 bg-paper" aria-hidden="true">
          <div className="h-full origin-left bg-signal" style={{ transform: `scaleX(${answeredCount / qs.length})` }} />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1280px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Question rail */}
        <nav aria-label={t("题目列表", "Questions")} className={`${railOpen ? "block" : "hidden"} lg:block`}>
          <div className="card sticky top-24 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{t("进度", "Progress")}</span>
              <span className="num text-sm text-mute">
                {String(answeredCount).padStart(2, "0")} / {qs.length}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {view.categories.map((c) => (
                <div key={c.code}>
                  <div className="label mb-1.5">{c.code}. {lang === "en" ? c.name_en : c.name_zh}</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {qs.filter((x) => x.category === c.code).map((x) => {
                      const i = qs.indexOf(x);
                      const l = localRef.current[x.code];
                      const done = !!(l.text.trim() || l.transcript.trim() || answersMeta[x.code]?.recording);
                      const cur = i === idx;
                      const disabled = !view.settings.allow_navigation && i < idx;
                      return (
                        <button
                          key={x.code}
                          type="button"
                          disabled={disabled}
                          onClick={() => { void go(i); setRailOpen(false); }}
                          aria-current={cur ? "step" : undefined}
                          aria-label={`${x.code} ${done ? t("已作答", "answered") : t("未作答", "not answered")}`}
                          className={`num rounded-md border py-1.5 text-sm ${cur ? "border-ink bg-ink text-sheet" : done ? "border-transparent bg-signal-wash text-signal-strong" : "border-rule bg-sheet text-ink-2 hover:border-ink-2"} disabled:opacity-40`}
                        >
                          {x.code}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-quiet mt-4 w-full" onClick={toReview}>{t("复查并提交", "Review and submit")}</button>
          </div>
        </nav>

        <main className="min-w-0 space-y-4">
          <div className="flex items-center gap-3 lg:hidden">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRailOpen((v) => !v)} aria-expanded={railOpen}>
              {railOpen ? t("收起题目列表", "Hide questions") : t("题目列表", "All questions")}
            </button>
            <span className="num text-sm text-mute">{t("进度", "Progress")} {String(answeredCount).padStart(2, "0")} / {qs.length}</span>
          </div>

          {lockedReason ? (
            <div className="rounded-md bg-watch-wash p-4 text-watch" role="alert">
              {lockedReason}{" "}
              <Link className="underline" href={`/candidate/review/${attemptId}`}>{t("前往复查页", "Go to review")}</Link>
            </div>
          ) : null}

          <details className="card protected group p-5" open={idx === 0} onCopy={(e) => blockCopy(e, "copy_blocked")} onCut={(e) => blockCopy(e, "cut_blocked")} onContextMenu={(e) => blockCopy(e, "contextmenu_blocked")}>
            <summary className="cursor-pointer list-none font-semibold">
              <span className="mr-2 inline-block text-mute group-open:rotate-90" aria-hidden="true">›</span>
              {lang === "en" ? view.scenario.title_en : view.scenario.title_zh}
            </summary>
            <p className="mt-3 text-ink-2">{lang === "en" ? view.scenario.body_en : view.scenario.body_zh}</p>
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-[0.95rem] text-ink-2 sm:grid-cols-2">
              {(lang === "en" ? view.scenario.facts_en : view.scenario.facts_zh).map((f) => (
                <li key={f} className="border-t border-rule pt-1.5">{f}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-mute">{lang === "en" ? view.scenario.note_en : view.scenario.note_zh}</p>
          </details>

          <section className="card p-5 sm:p-7" aria-labelledby="qtitle">
            <div
              className={view.settings.copy_restriction_enabled ? "protected" : ""}
              onCopy={(e) => blockCopy(e, "copy_blocked")}
              onCut={(e) => blockCopy(e, "cut_blocked")}
              onContextMenu={(e) => blockCopy(e, "contextmenu_blocked")}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm text-mute">
                <span>{t(`第 ${q.order} 题`, `Question ${q.order}`)}</span>
                <span aria-hidden="true">/</span>
                <span>{lang === "en" ? cat.name_en : cat.name_zh}</span>
                <span className={`tag ml-auto ${overSoft ? "tag-watch" : ""}`}>
                  {t("建议", "Target")} {Math.round(q.soft_limit_seconds / 60)} {t("分钟", "min")}
                </span>
              </div>
              <h1 id="qtitle" className="mt-3 text-[1.45rem] font-semibold leading-snug sm:text-[1.6rem]">{prompt}</h1>
              {lang === "en" ? <p className="mt-2 text-ink-2">{q.prompt_zh}</p> : null}
            </div>

            <label className="mt-6 block">
              <span className="label">{t("文字回答", "Written answer")}</span>
              <textarea
                className="field mt-1 min-h-[220px] resize-y text-[1rem] leading-relaxed"
                value={local.text}
                onChange={(e) => onText(e.target.value)}
                onPaste={(e) => blockPaste(e, "paste_blocked")}
                onDrop={(e) => blockPaste(e, "drop_blocked")}
                placeholder={t("请输入您的回答……（可选：也可以在下方录音）", "Type your answer… (or record it below)")}
                maxLength={20000}
                disabled={!!lockedReason}
                spellCheck={false}
              />
            </label>
            <div className="mt-1 flex justify-between text-xs text-faint">
              <span>{!pasteAllowed ? t("不支持粘贴", "Paste is off") : ""}</span>
              <span className="num">{local.text.length.toLocaleString()} {t("字", "chars")}</span>
            </div>

            <Recorder
              key={q.code}
              lang={lang}
              attemptId={attemptId}
              questionCode={q.code}
              consent={view.attempt.recording_consent}
              sttEnabled={sttEnabled}
              disabled={!!lockedReason}
              recording={meta?.recording ?? null}
              machineTranscript={meta?.machine_transcript ?? null}
              transcript={local.transcript}
              onTranscriptChange={onTranscript}
              onPasteBlocked={(e) => blockPaste(e, "paste_blocked")}
              onRecordingChange={(rec, machine, corrected, rev) => {
                setAnswersMeta((m) => ({ ...m, [q.code]: { ...m[q.code], recording: rec, machine_transcript: machine === undefined ? m[q.code].machine_transcript : machine } }));
                if (corrected !== undefined && corrected !== null && !local.transcript.trim()) {
                  local.transcript = corrected;
                  if (rev !== undefined) {
                    local.rev = Math.max(local.rev, rev);
                    local.savedRev = Math.max(local.savedRev, rev);
                  }
                  rerender();
                }
              }}
              onEvent={logEvent}
            />

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule pt-5">
              <button type="button" className="btn btn-quiet" onClick={() => go(idx - 1)} disabled={idx === 0 || !view.settings.allow_navigation}>
                {t("上一题", "Previous")}
              </button>
              <span className={`text-sm ${saveState === "saved" ? "text-good" : saveState === "dirty" || saveState === "saving" ? "text-mute" : "text-risk"}`} role="status" aria-live="polite">
                {t("保存状态：", "Status: ")}
                {saveLabel[saveState]}
              </span>
              <div className="ml-auto flex gap-3">
                <button type="button" className="btn btn-quiet" onClick={() => save(q.code)}>{t("立即保存", "Save now")}</button>
                {idx < qs.length - 1 ? (
                  <button type="button" className="btn btn-primary" onClick={() => go(idx + 1)}>{t("保存并下一题", "Save and next")}</button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={toReview}>{t("保存并复查", "Save and review")}</button>
                )}
              </div>
            </div>
          </section>

          <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="min-w-0 flex-1 text-ink-2">
              {t(`${candidateName}，答案会自动保存。这是您的私人续答链接，断网或换设备时用它继续（请勿分享）：`, `${candidateName}, answers save automatically. This is your private resume link for reconnecting or switching devices (don't share it):`)}
              <code className="mt-1 block break-all text-xs text-mute">{view.attempt.resume_url}</code>
            </span>
            <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { await navigator.clipboard.writeText(view.attempt.resume_url); showToast(t("续答链接已复制。", "Resume link copied.")); }}>
              {t("复制续答链接", "Copy resume link")}
            </button>
          </div>
        </main>
      </div>

      {toast ? (
        <div className="toast-in fixed inset-x-4 bottom-4 z-30 mx-auto max-w-[560px] rounded-[var(--radius-md)] bg-ink p-4 text-sheet shadow-lg" role="status">
          <p>{toast.msg}</p>
        </div>
      ) : null}

    </div>
  );
}
