import { Header } from "@/components/header";
import { requireAdminPage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { currentTemplate, listTemplateVersions } from "@/lib/assessment";
import { fmtDate, tr } from "@/lib/i18n";
import { TemplateForm } from "./form";

export const dynamic = "force-dynamic";

export default async function AssessmentsPage() {
  const admin = await requireAdminPage("/admin/assessments");
  const lang = await currentLang();
  const t = tr(lang);
  const tpl = currentTemplate();
  const versions = listTemplateVersions();
  return (
    <>
      <Header actor={admin} lang={lang} context={t("测评设置", "Assessment")} wide />
      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold">{tpl.title}</h1>
        <p className="mt-1 text-ink-2">{t(`当前版本 v${tpl.version}。修改设置会发布新版本；已开始的测评保留原版本快照。`, `Current version v${tpl.version}. Saving publishes a new version; attempts already started keep their snapshot.`)}</p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TemplateForm
            lang={lang}
            initial={{
              recommended_minutes: Math.round(tpl.recommended_seconds / 60),
              overall_limit_minutes: tpl.overall_limit_seconds ? Math.round(tpl.overall_limit_seconds / 60) : null,
              auto_submit_on_expiry: tpl.auto_submit_on_expiry,
              copy_restriction_enabled: tpl.copy_restriction_enabled,
              paste_restriction_enabled: tpl.paste_restriction_enabled,
              allow_navigation: tpl.allow_navigation,
              soft_limit_minutes: Math.round((tpl.questions[0]?.soft_limit_seconds ?? 240) / 60),
            }}
          />
          <aside className="card p-5">
            <h2 className="font-semibold">{t("版本历史", "Versions")}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="border-t border-rule pt-2">
                  <span className="num font-medium">v{v.version}</span> <span className="text-mute">{fmtDate(v.created_at, lang)}</span>
                  <div className="text-mute">{v.created_by_name ?? t("系统", "System")}，{t(`${v.attempts} 次测评`, `${v.attempts} attempts`)}</div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
        <h2 className="mt-10 text-xl font-semibold">{t("题目与评分要点", "Questions and rubric")}</h2>
        <div className="mt-3 overflow-x-auto rounded-[var(--radius-lg)] border border-rule bg-sheet">
          <table className="data">
            <thead>
              <tr>
                <th>{t("题号", "Code")}</th>
                <th>{t("题目", "Question")}</th>
                <th>{t("优秀回答应体现", "Strong answers show")}</th>
                <th className="text-right">{t("权重", "Weight")}</th>
              </tr>
            </thead>
            <tbody>
              {tpl.questions.map((q) => (
                <tr key={q.code}>
                  <td className="num font-medium">{q.code}</td>
                  <td className="max-w-[440px]">{lang === "en" ? q.prompt_en : q.prompt_zh}</td>
                  <td className="text-ink-2">{lang === "en" ? q.rubric_en : q.rubric_zh}</td>
                  <td className="num text-right text-mute">{q.weight}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
