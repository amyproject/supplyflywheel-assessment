"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

export function AcceptForm({ lang, token, email, name, signedInAs }: { lang: Lang; token: string; email: string; name: string; signedInAs: string | null }) {
  const t = tr(lang);
  const [fullName, setFullName] = useState(name);
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sameUser = signedInAs?.toLowerCase() === email.toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ redirect: string }>("/api/invitations/accept", { body: sameUser ? { token } : { token, password, full_name: fullName, phone: phone || null, location: location || null } });
      window.location.href = r.redirect;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="card p-7">
      <h1 className="text-2xl font-semibold">{t("接受测评邀请", "Accept your invitation")}</h1>
      <p className="mt-2 text-ink-2">{t("机器人供应链负责人测评", "Robotics Supply Chain Lead assessment")}</p>
      {signedInAs && !sameUser ? (
        <p className="mt-4 rounded-md bg-watch-wash p-3 text-sm text-watch">{t(`您当前以 ${signedInAs} 登录，此邀请属于 ${email}。请先退出。`, `You're signed in as ${signedInAs}; this invitation is for ${email}. Sign out first.`)}</p>
      ) : null}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="label">{t("邮箱", "Email")}</span>
          <input className="field mt-1" value={email} disabled readOnly />
        </label>
        {!sameUser ? (
          <>
            <label className="block">
              <span className="label">{t("姓名", "Full name")}</span>
              <input className="field mt-1" required maxLength={100} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">{t("手机（可选）", "Phone (optional)")}</span>
                <input className="field mt-1" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
              </label>
              <label className="block">
                <span className="label">{t("所在城市", "City")}</span>
                <input className="field mt-1" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("如：深圳", "e.g. Shenzhen")} />
              </label>
            </div>
            <label className="block">
              <span className="label">{t("设置密码（至少10位）", "Choose a password (10+ characters)")}</span>
              <input className="field mt-1" type="password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
          </>
        ) : null}
        {err ? <p className="text-sm text-risk" role="alert">{err}</p> : null}
        <button className="btn btn-primary w-full" disabled={busy || (!!signedInAs && !sameUser)}>{busy ? t("请稍候…", "One moment…") : sameUser ? t("接受邀请", "Accept invitation") : t("创建账户并继续", "Create account and continue")}</button>
      </form>
    </div>
  );
}
