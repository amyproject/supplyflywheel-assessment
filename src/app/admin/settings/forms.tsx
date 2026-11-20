"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

function CopyLink({ url, lang }: { url: string; lang: Lang }) {
  const t = tr(lang);
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-good-wash p-3">
      <code className="min-w-0 flex-1 break-all text-sm text-good">{url}</code>
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? t("已复制", "Copied") : t("复制链接", "Copy link")}
      </button>
    </div>
  );
}

export function InviteForm({ lang, emailOn }: { lang: Lang; emailOn: boolean }) {
  const t = tr(lang);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [send, setSend] = useState(emailOn);
  const [url, setUrl] = useState("");
  const [emailed, setEmailed] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card mt-5 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        setUrl("");
        try {
          const r = await api<{ url: string; emailed: boolean }>("/api/admin/invitations", { body: { email, full_name: name, send_email: send } });
          setUrl(r.url);
          setEmailed(r.emailed);
          setEmail("");
          setName("");
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[180px] flex-1">
          <span className="label">{t("姓名", "Name")}</span>
          <input className="field mt-1" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block min-w-[220px] flex-1">
          <span className="label">{t("邮箱", "Email")}</span>
          <input className="field mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {emailOn ? (
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-signal)]" checked={send} onChange={(e) => setSend(e.target.checked)} />
            {t("发送邮件", "Send email")}
          </label>
        ) : null}
        <button className="btn btn-primary" disabled={busy}>{t("生成邀请", "Create invitation")}</button>
      </div>
      {err ? <p className="mt-2 text-sm text-risk" role="alert">{err}</p> : null}
      {url ? (
        <>
          <p className="mt-3 text-sm text-ink-2">{emailed ? t("邀请邮件已发送。链接如下（14天内有效，仅显示一次）：", "Invitation emailed. The link (valid 14 days, shown once):") : t("邀请已创建。请复制链接发给候选人（14天内有效，仅显示一次）：", "Invitation created. Copy the link for the candidate (valid 14 days, shown once):")}</p>
          <CopyLink url={url} lang={lang} />
        </>
      ) : null}
    </form>
  );
}

export function InviteRowActions({ lang, id, revoked }: { lang: Lang; id: string; revoked: boolean }) {
  const t = tr(lang);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const act = async (action: "reissue" | "revoke") => {
    setErr("");
    try {
      const r = await api<{ url?: string }>(`/api/admin/invitations/${id}`, { body: { action } });
      if (r.url) setUrl(r.url);
      else window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => act("reissue")}>{t("重新生成链接", "New link")}</button>
        {!revoked ? <button type="button" className="btn btn-danger btn-sm" onClick={() => act("revoke")}>{t("撤销", "Revoke")}</button> : null}
      </div>
      {url ? <div className="w-full max-w-[420px] text-left"><CopyLink url={url} lang={lang} /></div> : null}
      {err ? <p className="text-sm text-risk">{err}</p> : null}
    </div>
  );
}

export function AdminForm({ lang }: { lang: Lang }) {
  const t = tr(lang);
  const [f, setF] = useState({ full_name: "", email: "", password: "", role: "admin" as "admin" | "super_admin" });
  const [msg, setMsg] = useState("");
  return (
    <form
      className="mt-5 space-y-3 border-t border-rule pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        try {
          await api("/api/admin/admins", { body: f });
          window.location.reload();
        } catch (e) {
          setMsg((e as Error).message);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="field" placeholder={t("姓名", "Name")} required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        <input className="field" type="email" placeholder={t("邮箱", "Email")} required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="field" type="password" minLength={12} placeholder={t("初始密码（至少12位）", "Initial password (12+)")} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "super_admin" })}>
          <option value="admin">{t("管理员", "Admin")}</option>
          <option value="super_admin">{t("超级管理员", "Super admin")}</option>
        </select>
      </div>
      <button className="btn btn-quiet btn-sm">{t("添加管理员", "Add admin")}</button>
      {msg ? <p className="text-sm text-risk">{msg}</p> : null}
    </form>
  );
}

export function RetentionForm({ lang, days }: { lang: Lang; days: number }) {
  const t = tr(lang);
  const [d, setD] = useState(days);
  const [msg, setMsg] = useState("");
  const save = async (purge: boolean) => {
    if (purge && !confirm(t(`永久删除 ${d} 天前的所有录音？`, `Permanently delete all recordings older than ${d} days?`))) return;
    try {
      const r = await api<{ purged: number }>("/api/admin/retention", { body: { retention_days: d, purge_now: purge } });
      setMsg(purge ? t(`已保存，删除 ${r.purged} 段录音`, `Saved; purged ${r.purged} recordings`) : t("已保存", "Saved"));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="label">{t("保留天数", "Days to keep")}</span>
        <input className="field mt-1 w-32" type="number" min={7} max={3650} value={d} onChange={(e) => setD(Number(e.target.value))} />
      </label>
      <button type="button" className="btn btn-quiet" onClick={() => save(false)}>{t("保存", "Save")}</button>
      <button type="button" className="btn btn-danger" onClick={() => save(true)}>{t("立即清除过期录音", "Purge expired recordings now")}</button>
      <span className="text-sm text-mute" role="status">{msg}</span>
    </div>
  );
}

export function PublicLink({ lang, url }: { lang: Lang; url: string }) {
  return <CopyLink url={url} lang={lang} />;
}

export function AccessCodeForm({ lang, initial }: { lang: Lang; initial: string }) {
  const t = tr(lang);
  const [code, setCode] = useState(initial);
  const [msg, setMsg] = useState("");
  const save = async (v: string) => {
    try {
      await api("/api/admin/access-code", { body: { access_code: v } });
      setCode(v);
      setMsg(v ? t("已启用口令", "Access code on") : t("已关闭口令，链接对所有人开放", "Access code off: the link is open to anyone"));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="card mt-4 p-5">
      <h2 className="font-semibold">{t("测评口令（可选）", "Access code (optional)")}</h2>
      <p className="mt-1 text-sm text-mute">{t("设置后，候选人需输入口令才能开始，防止链接被转发后被陌生人使用。", "When set, candidates must enter it to begin, so a forwarded link can't be used by strangers.")}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <input className="field max-w-[260px]" value={code} maxLength={100} onChange={(e) => setCode(e.target.value)} placeholder={t("留空 = 不需要口令", "Blank = no code")} aria-label={t("测评口令", "Access code")} />
        <button type="button" className="btn btn-quiet" onClick={() => save(code)}>{t("保存", "Save")}</button>
        {initial || code ? <button type="button" className="btn btn-quiet" onClick={() => save("")}>{t("关闭口令", "Turn off")}</button> : null}
        <span className="text-sm text-mute" role="status">{msg}</span>
      </div>
    </div>
  );
}
