import Link from "next/link";
import { Header } from "@/components/header";
import { requireAdminPage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { compareAttempts, dashboardRows } from "@/lib/admin";
import { currentTemplate } from "@/lib/assessment";
import { fmtHMS, tr } from "@/lib/i18n";
import { bandLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const admin = await requireAdminPage("/admin/compare");
  const lang = await currentLang();
  const t = tr(lang);
  const { ids } = await searchParams;
  const list = (ids ?? "").split(",").filter(Boolean);
  const tpl = currentTemplate();
  if (list.length < 2) {
    const candidates = dashboardRows(admin, {}).filter((r) => r.attempt_id && r.scored > 0);
    return (
      <>
        <Header actor={admin} lang={lang} context={t("对比", "Compare")} wide />
        <main className="mx-auto max-w-[900px] px-4 py-10">
          <h1 className="text-3xl font-semibold">{t("对比候选人", "Compare candidates")}</h1>
          <p className="mt-2 text-ink-2">{t("选择2–6位已有评分的候选人。", "Pick 2–6 candidates who have scores.")}</p>
          <form method="get" className="card mt-6 p-5">
            <div className="space-y-2">
              {candidates.length === 0 ? <p className="text-mute">{t("暂无已评分的候选人。", "No scored candidates yet.")}</p> : null}
              {candidates.map((c) => (
                <label key={c.attempt_id} className="flex items-center gap-3">
                  <input type="checkbox" name="pick" value={c.attempt_id!} className="h-4 w-4 accent-[var(--color-signal)]" />
                  <span>{c.full_name}</span>
                  <span className="num ml-auto text-mute">{c.score?.toFixed(1)}</span>
                </label>
              ))}
            </div>
            <CompareSubmit label={t("对比所选", "Compare selected")} />
          </form>
        </main>
      </>
    );
  }
  const rows = compareAttempts(admin, list);
  const best = (vals: (number | null)[]) => Math.max(...vals.filter((v): v is number => v !== null));
  return (
    <>
      <Header actor={admin} lang={lang} context={t("对比", "Compare")} wide />
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <Link href="/admin" className="text-sm text-mute hover:underline">{t("返回候选人列表", "Back to candidates")}</Link>
        <h1 className="mt-3 text-3xl font-semibold">{t("候选人对比", "Candidate comparison")}</h1>
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-lg)] border border-rule bg-sheet">
          <table className="data">
            <thead>
              <tr>
                <th />
                {rows.map((r) => (
                  <th key={r.attempt_id} className="text-right">
                    <Link className="font-semibold text-ink hover:underline" href={`/admin/attempts/${r.attempt_id}`}>{r.candidate.full_name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">{t("综合评分", "Overall")}</td>
                {rows.map((r) => {
                  const v = r.score.final ?? r.score.provisional;
                  const b = bandLabel(lang, r.band);
                  return (
                    <td key={r.attempt_id} className="text-right">
                      <div className="num text-xl font-semibold">{v === null ? "—" : v.toFixed(1)}</div>
                      <div className="text-xs text-mute">{r.score.final !== null ? (b ? b[0] : "") : t(`暂定 ${r.score.scoredQuestions}/${r.score.totalQuestions}`, `prov. ${r.score.scoredQuestions}/${r.score.totalQuestions}`)}</div>
                    </td>
                  );
                })}
              </tr>
              {tpl.categories.map((c) => {
                const vals = rows.map((r) => r.score.categories.find((x) => x.code === c.code)?.points ?? null);
                const top = best(vals);
                return (
                  <tr key={c.code}>
                    <td>{c.code}. {lang === "en" ? c.name_en : c.name_zh} <span className="text-mute">({c.weight}%)</span></td>
                    {vals.map((v, i) => (
                      <td key={i} className={`num text-right ${v !== null && v === top && rows.length > 1 ? "font-semibold text-signal-strong" : ""}`}>{v === null ? "—" : v.toFixed(1)}</td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td>{t("总用时 / 有效作答", "Total / active time")}</td>
                {rows.map((r) => (
                  <td key={r.attempt_id} className="num text-right text-mute">{fmtHMS(r.elapsed_seconds)} / {fmtHMS(r.active_seconds)}</td>
                ))}
              </tr>
              {tpl.questions.map((q) => (
                <tr key={q.code}>
                  <td className="text-sm"><span className="num font-medium">{q.code}</span> <span className="text-mute">{(lang === "en" ? q.prompt_en : q.prompt_zh).slice(0, lang === "en" ? 60 : 26)}…</span></td>
                  {rows.map((r) => {
                    const s = r.questions.find((x) => x.code === q.code)?.score ?? null;
                    return <td key={r.attempt_id} className="num text-right">{s ?? "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function CompareSubmit({ label }: { label: string }) {
  return (
    <div className="mt-4">
      <button className="btn btn-primary" formAction="/admin/compare/go">{label}</button>
    </div>
  );
}
