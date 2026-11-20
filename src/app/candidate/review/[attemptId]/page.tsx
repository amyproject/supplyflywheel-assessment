import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/header";
import { requireCandidatePage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { candidateView } from "@/lib/assessment";
import { HttpError } from "@/lib/http";
import { fmtHMS, tr } from "@/lib/i18n";
import { SubmitPanel } from "./submit";
import { ProtectedArea } from "@/components/protected-area";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const actor = await requireCandidatePage(`/candidate/review/${attemptId}`);
  const lang = await currentLang();
  const t = tr(lang);
  let v;
  try {
    v = candidateView(actor, attemptId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  if (v.attempt.status === "submitted") redirect(`/candidate/submitted?attempt=${attemptId}`);
  const answered = v.answers.filter((a) => a.answered).length;
  const byCode = new Map(v.answers.map((a) => [a.question_code, a]));
  return (
    <>
      <Header actor={actor} lang={lang} context={t("复查并提交", "Review and submit")} />
      <ProtectedArea lang={lang} attemptId={attemptId}>
      <main className="mx-auto max-w-[920px] px-4 py-10">
        <h1 className="text-3xl font-semibold">{t("复查并提交", "Review and submit")}</h1>
        <p className="mt-2 text-ink-2">
          {t(`已作答 ${answered} / ${v.questions.length} 题。`, `${answered} of ${v.questions.length} answered.`)}{" "}
          {v.attempt.editable ? t("点击任意题目可返回修改。", "Select any question to go back and edit it.") : t("时间已到，答案已锁定，您仍可提交已保存的内容。", "Time is up and answers are locked; you can still submit what was saved.")}
        </p>
        <div className="mt-8 overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-sheet">
          <table className="data">
            <thead>
              <tr>
                <th>{t("题号", "No.")}</th>
                <th>{t("题目", "Question")}</th>
                <th>{t("作答方式", "Answer")}</th>
                <th className="text-right">{t("用时", "Time")}</th>
              </tr>
            </thead>
            <tbody>
              {v.questions.map((q) => {
                const a = byCode.get(q.code)!;
                const modes = [a.typed_text.trim() ? t("文字", "Text") : null, a.recording ? t("录音", "Audio") : null, a.corrected_transcript?.trim() ? t("转写", "Transcript") : null].filter(Boolean);
                return (
                  <tr key={q.code}>
                    <td className="num">{q.code}</td>
                    <td className="max-w-[460px]">
                      {v.attempt.editable && v.settings.allow_navigation ? (
                        <a className="hover:underline" href={`/candidate/assessment/${attemptId}?q=${q.code}`}>{lang === "en" ? q.prompt_en : q.prompt_zh}</a>
                      ) : lang === "en" ? q.prompt_en : q.prompt_zh}
                    </td>
                    <td>{modes.length ? <span className="tag tag-good">{modes.join(" + ")}</span> : <span className="tag tag-watch">{t("未作答", "Not answered")}</span>}</td>
                    <td className="num text-right text-mute">{fmtHMS(a.active_duration_seconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <SubmitPanel lang={lang} attemptId={attemptId} unanswered={v.questions.length - answered} editable={v.attempt.editable} />
      </main>
      </ProtectedArea>
    </>
  );
}
