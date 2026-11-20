import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { requireAdminPage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { candidateDetail } from "@/lib/admin";
import { HttpError } from "@/lib/http";
import { fmtDate, fmtHMS, tr } from "@/lib/i18n";
import { bandLabel, statusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const admin = await requireAdminPage(`/admin/candidates/${candidateId}`);
  const lang = await currentLang();
  const t = tr(lang);
  let d;
  try {
    d = candidateDetail(admin, candidateId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <Header actor={admin} lang={lang} context={t("候选人详情", "Candidate")} wide />
      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link href="/admin" className="text-sm text-mute hover:underline">{t("返回候选人列表", "Back to candidates")}</Link>
        <h1 className="mt-3 text-3xl font-semibold">{d.user.full_name}</h1>
        <dl className="card mt-5 grid gap-x-6 gap-y-3 p-5 text-[0.95rem] sm:grid-cols-4">
          {[
            [t("邮箱", "Email"), d.user.email],
            [t("手机", "Phone"), d.user.phone ?? "—"],
            [t("城市", "City"), d.user.location ?? "—"],
            [t("注册时间", "Joined"), fmtDate(d.user.created_at, lang)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd className="mt-0.5 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-8 text-xl font-semibold">{t("测评记录", "Attempts")}</h2>
        <div className="mt-3 overflow-x-auto rounded-[var(--radius-lg)] border border-rule bg-sheet">
          <table className="data">
            <thead>
              <tr>
                <th>{t("开始", "Started")}</th>
                <th>{t("状态", "Status")}</th>
                <th className="text-right">{t("完成题数", "Answered")}</th>
                <th className="text-right">{t("总用时", "Total")}</th>
                <th className="text-right">{t("评分", "Score")}</th>
                <th>{t("建议", "Band")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.attempts.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-mute">{t("尚未开始测评。", "No attempt started yet.")}</td></tr>
              ) : (
                d.attempts.map((r) => {
                  const [sl, sc] = statusLabel(lang, r.status);
                  const b = bandLabel(lang, r.band);
                  return (
                    <tr key={r.attempt_id}>
                      <td>{fmtDate(r.started_at, lang)}</td>
                      <td><span className={`tag ${sc}`}>{sl}</span></td>
                      <td className="num text-right">{r.answered}/{r.total}</td>
                      <td className="num text-right">{fmtHMS(r.elapsed_seconds)}</td>
                      <td className="num text-right">{r.score === null ? "—" : r.score.toFixed(1)}{r.score !== null && !r.score_is_final ? t("（暂定）", " (prov.)") : ""}</td>
                      <td>{b ? <span className={`tag ${b[1]}`}>{b[0]}</span> : "—"}</td>
                      <td className="text-right"><Link className="btn btn-quiet btn-sm" href={`/admin/attempts/${r.attempt_id}`}>{t("查看评分", "Open")}</Link></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <h2 className="mt-8 text-xl font-semibold">{t("邀请", "Invitations")}</h2>
        <ul className="mt-3 space-y-1 text-[0.95rem] text-ink-2">
          {d.invitations.map((i) => (
            <li key={i.id}>
              {fmtDate(i.created_at, lang)}：{i.revoked_at ? t("已撤销", "revoked") : i.accepted_at ? t(`已接受 ${fmtDate(i.accepted_at, lang)}`, `accepted ${fmtDate(i.accepted_at, lang)}`) : t(`待接受，${fmtDate(i.expires_at, lang)} 过期`, `pending, expires ${fmtDate(i.expires_at, lang)}`)}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
