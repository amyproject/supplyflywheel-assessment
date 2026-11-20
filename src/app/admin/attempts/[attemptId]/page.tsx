import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { requireAdminPage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { attemptDetail } from "@/lib/admin";
import { HttpError } from "@/lib/http";
import { fmtDate, fmtHMS, tr } from "@/lib/i18n";
import { EVENT_LABELS, statusLabel } from "@/lib/labels";
import { INTEGRITY_EVENT_TYPES } from "@/lib/assessment";
import { ScoreSummaryPanel, QuestionReview, AttemptActions } from "./client";

export const dynamic = "force-dynamic";

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const admin = await requireAdminPage(`/admin/attempts/${attemptId}`);
  const lang = await currentLang();
  const t = tr(lang);
  let d;
  try {
    d = attemptDetail(admin, attemptId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const a = d.attempt;
  const [sl, sc] = statusLabel(lang, a.archived_at ? "archived" : a.status);
  const integrity = d.events.filter((e) => INTEGRITY_EVENT_TYPES.includes(e.event_type));
  const timeline = d.events.filter((e) => e.event_type !== "question_open" && e.event_type !== "question_leave");
  return (
    <>
      <Header actor={admin} lang={lang} context={t("答案与评分", "Answers and scoring")} wide />
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <Link href="/admin" className="text-sm text-mute hover:underline">{t("返回候选人列表", "Back to candidates")}</Link>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold">{d.candidate.full_name}</h1>
            <p className="mt-1 text-ink-2">
              <Link className="hover:underline" href={`/admin/candidates/${d.candidate.id}`}>{d.candidate.email}</Link>
              {d.candidate.phone ? `，${d.candidate.phone}` : ""}
              {d.candidate.location ? `，${d.candidate.location}` : ""}
            </p>
          </div>
          <span className={`tag ${sc} mt-2`}>{sl}</span>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <dl className="card grid gap-x-6 gap-y-3 p-5 text-[0.93rem] sm:grid-cols-3">
              {[
                [t("开始", "Started"), fmtDate(a.started_at, lang)],
                [t("提交", "Submitted"), fmtDate(a.submitted_at, lang)],
                [t("总用时", "Total time"), fmtHMS(d.elapsed_seconds)],
                [t("有效作答", "Active time"), fmtHMS(a.total_active_seconds)],
                [t("时间上限", "Deadline"), a.deadline_at ? fmtDate(a.deadline_at, lang) : t("无", "None")],
                [t("模板版本", "Template"), `v${d.snapshot.version}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="num mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-mute">
              {t("录音同意：", "Recording consent: ")}
              {a.consent_recording_at ? fmtDate(a.consent_recording_at, lang) : t("未同意", "not given")}
              {t("；粘贴：", "; paste: ")}
              {!d.snapshot.paste_restriction_enabled ? t("模板未限制", "not restricted") : a.paste_accommodation ? t("已为该候选人开启", "allowed for this candidate") : t("已限制", "restricted")}
              {a.extension_seconds ? t(`；已延长 ${Math.round(a.extension_seconds / 60)} 分钟`, `; extended ${Math.round(a.extension_seconds / 60)} min`) : ""}
              {t("。时间均为北京时间。", ". Times are Beijing time.")}
            </p>

            {d.questions.map((x) => (
              <QuestionReview
                key={x.question.code}
                lang={lang}
                attemptId={a.id}
                data={JSON.parse(JSON.stringify(x))}
                categoryName={(() => {
                  const c = d.snapshot.categories.find((c) => c.code === x.question.category)!;
                  return lang === "en" ? c.name_en : c.name_zh;
                })()}
              />
            ))}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <ScoreSummaryPanel lang={lang} initial={d.score} band={d.band} categories={d.snapshot.categories} reviewers={d.reviewers} />
            <AttemptActions lang={lang} attemptId={a.id} status={a.status} archived={!!a.archived_at} hasDeadline={!!a.deadline_at} pasteRestricted={d.snapshot.paste_restriction_enabled} pasteAllowed={!!a.paste_accommodation} accommodations={d.accommodations} />
            <section className="card p-5">
              <h2 className="font-semibold">{t("活动记录", "Activity")}</h2>
              <p className="mt-1 text-sm text-mute">
                {t(`诚信相关事件 ${integrity.length} 条。仅供参考：切换页面可能只是查看邮件或网络问题。`, `${integrity.length} integrity-related events. Context only: a tab switch may just be checking email or a network blip.`)}
              </p>
              <ol className="mt-3 max-h-[420px] space-y-1.5 overflow-y-auto text-sm">
                {timeline.slice(-200).map((e, i) => {
                  const lbl = EVENT_LABELS[e.event_type];
                  return (
                    <li key={i} className="flex gap-3 border-t border-rule pt-1.5">
                      <span className="num shrink-0 text-mute">{new Date(e.occurred_at).toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</span>
                      <span className={INTEGRITY_EVENT_TYPES.includes(e.event_type) ? "text-watch" : ""}>
                        {lbl ? (lang === "en" ? lbl[1] : lbl[0]) : e.event_type}
                        {e.question_code ? <span className="num text-mute"> {e.question_code}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
