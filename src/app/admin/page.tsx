import Link from "next/link";
import { Header } from "@/components/header";
import { requireAdminPage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { dashboardRows } from "@/lib/admin";
import { fmtHMS, tr } from "@/lib/i18n";
import { bandLabel, statusLabel } from "@/lib/labels";
import { CompareSelect } from "./compare-select";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; band?: string }> }) {
  const admin = await requireAdminPage("/admin");
  const lang = await currentLang();
  const t = tr(lang);
  const sp = await searchParams;
  const rows = dashboardRows(admin, { q: sp.q, status: sp.status, band: sp.band });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const counts = {
    total: rows.length,
    submitted: rows.filter((r) => r.status === "submitted").length,
    active: rows.filter((r) => r.status === "in_progress" || r.status === "reopened").length,
    toScore: rows.filter((r) => r.status === "submitted" && !r.score_is_final).length,
  };
  return (
    <>
      <Header actor={admin} lang={lang} context={t("候选人评估", "Candidate assessments")} wide />
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h1 className="text-3xl font-semibold">{t("候选人", "Candidates")}</h1>
            <p className="mt-1 text-ink-2">
              {t(`${counts.total} 位，已提交 ${counts.submitted}，进行中 ${counts.active}，待完成评分 ${counts.toScore}。`, `${counts.total} total: ${counts.submitted} submitted, ${counts.active} in progress, ${counts.toScore} awaiting scores.`)}
            </p>
          </div>
          <Link href="/admin/settings#link" className="btn btn-primary ml-auto">{t("获取测评链接", "Get the test link")}</Link>
        </div>

        <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
          <label className="block min-w-[220px] flex-1">
            <span className="label">{t("搜索", "Search")}</span>
            <input className="field mt-1" name="q" defaultValue={sp.q ?? ""} placeholder={t("姓名/邮箱", "Name or email")} />
          </label>
          <label className="block">
            <span className="label">{t("状态", "Status")}</span>
            <select className="field mt-1" name="status" defaultValue={sp.status ?? "all"}>
              <option value="all">{t("全部", "All")}</option>
              {["invited", "in_progress", "reopened", "submitted", "expired", "archived"].map((s) => (
                <option key={s} value={s}>{statusLabel(lang, s)[0]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t("分数", "Score")}</span>
            <select className="field mt-1" name="band" defaultValue={sp.band ?? "all"}>
              <option value="all">{t("全部", "All")}</option>
              {["finalist", "interview", "conditional", "not_recommended"].map((b) => (
                <option key={b} value={b}>{bandLabel(lang, b)![0]}</option>
              ))}
              <option value="provisional">{t("暂定分（未评完）", "Provisional (partly scored)")}</option>
              <option value="unscored">{t("未评分", "Unscored")}</option>
            </select>
          </label>
          <button className="btn btn-quiet">{t("筛选", "Filter")}</button>
          <div className="ml-auto flex gap-2">
            <a className="btn btn-quiet" href={`/api/admin/exports/csv?${qs}`}>{t("导出CSV", "Export CSV")}</a>
            <a className="btn btn-quiet" href={`/api/admin/exports/csv?detail=answers&${qs}`}>{t("导出全部答案", "Export answers")}</a>
          </div>
        </form>

        <CompareSelect lang={lang}>
          <div className="mt-5 overflow-x-auto rounded-[var(--radius-lg)] border border-rule bg-sheet">
            <table className="data">
              <thead>
                <tr>
                  <th className="w-8"><span className="sr-only">{t("对比", "Compare")}</span></th>
                  <th>{t("候选人", "Candidate")}</th>
                  <th>{t("状态", "Status")}</th>
                  <th className="text-right">{t("完成题数", "Answered")}</th>
                  <th className="text-right">{t("总用时", "Total time")}</th>
                  <th className="text-right">{t("有效作答时间", "Active time")}</th>
                  <th className="text-right">{t("综合评分", "Score")}</th>
                  <th>{t("建议", "Band")}</th>
                  <th className="text-right">{t("诚信事件", "Integrity events")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-mute">{t("没有符合条件的候选人。", "No candidates match.")}</td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const [sl, sc] = statusLabel(lang, r.status);
                    const b = bandLabel(lang, r.band);
                    return (
                      <tr key={r.attempt_id ?? r.invitation_id}>
                        <td>{r.attempt_id ? <input type="checkbox" name="cmp" value={r.attempt_id} aria-label={t(`选择 ${r.full_name} 进行对比`, `Select ${r.full_name} to compare`)} className="h-4 w-4 accent-[var(--color-signal)]" /> : null}</td>
                        <td>
                          <div className="font-medium">{r.candidate_id ? <Link className="hover:underline" href={`/admin/candidates/${r.candidate_id}`}>{r.full_name}</Link> : r.full_name}</div>
                          <div className="text-sm text-mute">{r.email}{r.location ? `，${r.location}` : ""}</div>
                        </td>
                        <td>
                          <span className={`tag ${sc}`}>{sl}</span>
                          {r.open_accommodations ? <span className="tag tag-watch ml-1">{t("待处理申请", "Open request")}</span> : null}
                        </td>
                        <td className="num text-right">{r.answered}/{r.total}</td>
                        <td className="num text-right">{fmtHMS(r.elapsed_seconds)}</td>
                        <td className="num text-right text-mute">{fmtHMS(r.active_seconds)}</td>
                        <td className="num text-right font-semibold">
                          {r.score === null ? "—" : r.score.toFixed(1)}
                          {r.score !== null && !r.score_is_final ? <div className="text-xs font-normal text-mute">{t(`暂定 ${r.scored}/${r.total}`, `prov. ${r.scored}/${r.total}`)}</div> : null}
                        </td>
                        <td>{b ? <span className={`tag ${b[1]}`}>{b[0]}</span> : <span className="text-mute">—</span>}</td>
                        <td className="num text-right text-mute">{r.attempt_id ? r.integrity_events : "—"}</td>
                        <td className="text-right">{r.attempt_id ? <Link className="btn btn-quiet btn-sm" href={`/admin/attempts/${r.attempt_id}`}>{t("查看评分", "Open")}</Link> : null}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CompareSelect>
        <p className="mt-3 text-sm text-mute">{t("分数段为参考启发值，并非经过验证的心理测量标准。诚信事件仅供人工参考，不能单独作为淘汰依据。", "Bands are heuristics, not validated psychometric cutoffs. Integrity events are context for reviewers and never grounds for rejection on their own.")}</p>
      </main>
    </>
  );
}
