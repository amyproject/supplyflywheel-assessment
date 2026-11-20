import { Header } from "@/components/header";
import { requireCandidatePage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { candidateView, receiptCode } from "@/lib/assessment";
import { fmtDate, fmtHMS, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function Submitted({ searchParams }: { searchParams: Promise<{ attempt?: string }> }) {
  const actor = await requireCandidatePage("/candidate");
  const lang = await currentLang();
  const t = tr(lang);
  const { attempt } = await searchParams;
  let v: ReturnType<typeof candidateView> | null = null;
  try {
    v = attempt ? candidateView(actor, attempt) : null;
  } catch {
    v = null;
  }
  const ok = v && v.attempt.status === "submitted";
  return (
    <>
      <Header actor={actor} lang={lang} />
      <main className="mx-auto max-w-[620px] px-4 py-16">
        <div className="card p-8">
          {ok && v ? (
            <>
              <h1 className="text-3xl font-semibold">{t("已提交，感谢您的作答", "Submitted. Thank you")}</h1>
              <p className="mt-3 text-ink-2">{t("招聘团队会人工评审您的回答，并通过邮件与您联系。", "The hiring team reviews every answer by hand and will follow up by email.")}</p>
              <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 border-t border-rule pt-5 text-[0.95rem]">
                <dt className="text-mute">{t("回执编号", "Receipt")}</dt>
                <dd className="num font-semibold">{receiptCode(v.attempt.id)}</dd>
                <dt className="text-mute">{t("提交时间", "Submitted")}</dt>
                <dd>{fmtDate(v.attempt.submitted_at, lang)}{t("（北京时间）", " (Beijing time)")}</dd>
                <dt className="text-mute">{t("总用时", "Total time")}</dt>
                <dd className="num">{fmtHMS((Date.parse(v.attempt.submitted_at!) - Date.parse(v.attempt.started_at)) / 1000)}</dd>
                <dt className="text-mute">{t("已作答", "Answered")}</dt>
                <dd className="num">{v.answers.filter((a) => a.answered).length} / {v.questions.length}</dd>
              </dl>
            </>
          ) : (
            <h1 className="text-2xl font-semibold">{t("没有找到已提交的测评", "No submitted assessment found")}</h1>
          )}
        </div>
      </main>
    </>
  );
}
