"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

interface S {
  recommended_minutes: number;
  overall_limit_minutes: number | null;
  auto_submit_on_expiry: boolean;
  copy_restriction_enabled: boolean;
  paste_restriction_enabled: boolean;
  allow_navigation: boolean;
  soft_limit_minutes: number;
}

export function TemplateForm({ lang, initial }: { lang: Lang; initial: S }) {
  const t = tr(lang);
  const [s, setS] = useState<S>(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ version: number }>("/api/admin/templates", { body: s });
      setMsg(t(`已发布 v${r.version}`, `Published v${r.version}`));
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const check = (k: "auto_submit_on_expiry" | "copy_restriction_enabled" | "paste_restriction_enabled" | "allow_navigation", label: string, hint: string) => (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[var(--color-signal)]" checked={s[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>
        {label}
        <span className="block text-sm text-mute">{hint}</span>
      </span>
    </label>
  );
  return (
    <section className="card space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="label">{t("建议总时长（分钟）", "Suggested total (min)")}</span>
          <input className="field mt-1" type="number" min={10} max={600} value={s.recommended_minutes} onChange={(e) => set("recommended_minutes", Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="label">{t("硬性上限（分钟，留空=无）", "Hard cap (min, blank = none)")}</span>
          <input className="field mt-1" type="number" min={10} max={720} value={s.overall_limit_minutes ?? ""} onChange={(e) => set("overall_limit_minutes", e.target.value === "" ? null : Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="label">{t("每题建议（分钟）", "Per-question target (min)")}</span>
          <input className="field mt-1" type="number" min={1} max={60} value={s.soft_limit_minutes} onChange={(e) => set("soft_limit_minutes", Number(e.target.value))} />
        </label>
      </div>
      <div className="space-y-3">
        {check("auto_submit_on_expiry", t("到达上限时自动提交", "Auto-submit at the cap"), t("关闭时：到时答案锁定，候选人仍可手动提交已保存内容。", "Off: answers lock at the cap and the candidate can still submit what was saved."))}
        {check("allow_navigation", t("允许在题目间自由跳转", "Allow moving between questions"), t("关闭时：一次一题，只能向前。", "Off: one question at a time, forward only."))}
        {check("copy_restriction_enabled", t("题目区域禁止选中/复制（尽力而为）", "Discourage selecting/copying question text (best effort)"), t("无法阻止截图、拍照或开发者工具。", "Can't stop screenshots, photos or developer tools."))}
        {check("paste_restriction_enabled", t("答题框禁止粘贴", "Block paste in answer boxes"), t("不影响中文输入法。如有特殊需要，可在候选人详情页单独开启。", "Chinese IME input is unaffected. For special needs you can allow it per candidate on their detail page."))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{t("发布新版本", "Publish new version")}</button>
        <span className="text-sm text-mute" role="status">{msg}</span>
      </div>
    </section>
  );
}
