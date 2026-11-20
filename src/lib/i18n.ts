/** Chinese-first UI with an English toggle. Strings live side by side at the call site: t("中文", "English"). */
export type Lang = "zh" | "en";
export const LANG_COOKIE = "sfa_lang";
export const tr = (lang: Lang) => (zh: string, en: string) => (lang === "en" ? en : zh);
export const asLang = (v: string | undefined | null): Lang => (v === "en" ? "en" : "zh");

export function fmtHMS(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return "—";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function fmtMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
}
