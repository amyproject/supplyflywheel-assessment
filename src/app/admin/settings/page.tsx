import { Header } from "@/components/header";
import { requireAdminPage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { auditLog, listAdmins } from "@/lib/admin";
import { getSetting } from "@/lib/db";
import { config } from "@/lib/config";
import { fmtDate, tr } from "@/lib/i18n";
import { AccessCodeForm, AdminForm, PublicLink, RetentionForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const admin = await requireAdminPage("/admin/settings");
  const lang = await currentLang();
  const t = tr(lang);
  const admins = listAdmins(admin);
  const log = auditLog(admin, 100);
  return (
    <>
      <Header actor={admin} lang={lang} context={t("测评链接与设置", "Link and settings")} wide />
      <main className="mx-auto max-w-[1180px] space-y-10 px-4 py-8 sm:px-6">
        <section id="link">
          <h1 className="text-3xl font-semibold">{t("测评链接", "Test link")}</h1>
          <p className="mt-1 text-ink-2">{t("把这个链接发给候选人（微信、邮件或招聘网站均可）。候选人无需注册，填写姓名和邮箱即可开始；每个邮箱只能参加一次。", "Send this link to candidates by WeChat, email or a job board. No account needed: they enter a name and email and begin. One attempt per email.")}</p>
          <PublicLink lang={lang} url={`${config.appBaseUrl}/start`} />
          <AccessCodeForm lang={lang} initial={getSetting("access_code", "")} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h2 className="text-xl font-semibold">{t("管理员", "Admins")}</h2>
            <ul className="mt-3 space-y-2 text-[0.95rem]">
              {admins.map((a) => (
                <li key={a.id} className="flex items-center gap-2 border-t border-rule pt-2">
                  <span className="font-medium">{a.full_name}</span>
                  <span className="text-mute">{a.email}</span>
                  <span className="tag ml-auto">{a.role === "super_admin" ? t("超级管理员", "Super admin") : t("管理员", "Admin")}</span>
                </li>
              ))}
            </ul>
            {admin.role === "super_admin" ? <AdminForm lang={lang} /> : <p className="mt-4 text-sm text-mute">{t("仅超级管理员可添加管理员。", "Only super admins can add admins.")}</p>}
          </div>
          <div className="card p-6">
            <h2 className="text-xl font-semibold">{t("数据保留", "Retention")}</h2>
            <p className="mt-2 text-ink-2">{t("录音在保留期后可被清除；答案文本与评分保留用于招聘记录。", "Recordings can be purged after the retention period; answer text and scores stay with the hiring record.")}</p>
            {admin.role === "super_admin" ? <RetentionForm lang={lang} days={Number(getSetting("retention_days", "365"))} /> : <p className="mt-4 text-sm text-mute">{t(`当前：${getSetting("retention_days", "365")} 天`, `Current: ${getSetting("retention_days", "365")} days`)}</p>}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold">{t("审计日志", "Audit log")}</h2>
          <p className="mt-1 text-sm text-mute">{t("最近100条管理员操作，包括查看答案和收听/下载录音。", "Last 100 admin actions, including viewing answers and playing or downloading recordings.")}</p>
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-lg)] border border-rule bg-sheet">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("时间", "Time")}</th>
                  <th>{t("管理员", "Admin")}</th>
                  <th>{t("操作", "Action")}</th>
                  <th>{t("对象", "Target")}</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="text-sm">{fmtDate(l.occurred_at, lang)}</td>
                    <td>{l.admin_name}</td>
                    <td className="num text-sm">{l.action}</td>
                    <td className="num text-sm text-mute">{l.target_type}{l.target_id ? ` ${l.target_id.slice(0, 14)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
