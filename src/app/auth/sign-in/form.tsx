"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

export function SignInForm({ lang, next, linkError }: { lang: Lang; next?: string; linkError: boolean }) {
  const t = tr(lang);
  const mode = "password" as "password" | "link";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(linkError ? t("登录链接无效或已过期。", "That sign-in link is invalid or expired.") : "");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (mode === "password") {
        const r = await api<{ redirect: string }>("/api/auth/sign-in", { body: { email, password } });
        window.location.href = next ?? r.redirect;
      } else {
        await api("/api/auth/link", { body: { email } });
        setSent(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-7">
      <h1 className="text-2xl font-semibold">{t("管理员登录", "Admin sign-in")}</h1>
      <p className="mt-1 text-sm text-mute">{t("查看全部候选人的答案、录音与评分。", "See every candidate's answers, recordings and scores.")}</p>
      {sent ? (
        <p className="mt-6 rounded-md bg-good-wash p-4 text-good" role="status">{t("如果该邮箱已注册，登录链接已发送（15分钟内有效）。", "If that email is registered, a sign-in link is on its way (valid 15 minutes).")}</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="label">{t("邮箱", "Email")}</span>
            <input className="field mt-1" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode === "password" ? (
            <label className="block">
              <span className="label">{t("密码", "Password")}</span>
              <input className="field mt-1" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          ) : null}
          {err ? <p className="text-sm text-risk" role="alert">{err}</p> : null}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? t("请稍候…", "One moment…") : mode === "password" ? t("登录", "Sign in") : t("发送链接", "Send link")}</button>
        </form>
      )}
      <p className="mt-6 text-sm text-mute">{t("参加测评无需登录：", "Taking the test? No sign-in needed: ")}<a className="underline" href="/start">{t("前往开始页", "go to the start page")}</a></p>
    </div>
  );
}
