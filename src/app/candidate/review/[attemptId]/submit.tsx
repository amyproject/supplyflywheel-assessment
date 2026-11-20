"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

export function SubmitPanel({ lang, attemptId, unanswered, editable }: { lang: Lang; attemptId: string; unanswered: number; editable: boolean }) {
  const t = tr(lang);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/attempts/${attemptId}/submit`, { method: "POST" });
      window.location.href = `/candidate/submitted?attempt=${attemptId}`;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="card mt-6 p-6">
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          {editable ? <a className="btn btn-quiet" href={`/candidate/assessment/${attemptId}`}>{t("返回继续作答", "Back to the questions")}</a> : null}
          <button type="button" className="btn btn-primary ml-auto" onClick={() => setConfirming(true)}>{t("提交测评", "Submit assessment")}</button>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold">{t("确认提交？", "Submit now?")}</h2>
          <p className="mt-2 text-ink-2">
            {unanswered > 0 ? t(`还有 ${unanswered} 题未作答。`, `${unanswered} question(s) are unanswered. `) : ""}
            {t("提交后答案将锁定，无法再修改。", "Once submitted, your answers are locked.")}
          </p>
          {err ? <p className="mt-2 text-sm text-risk" role="alert">{err}</p> : null}
          <div className="mt-4 flex gap-3">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)} disabled={busy}>{t("取消", "Cancel")}</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? t("提交中…", "Submitting…") : t("确认提交", "Confirm and submit")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
