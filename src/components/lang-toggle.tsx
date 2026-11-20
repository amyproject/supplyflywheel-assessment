"use client";
import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n";

export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const set = (l: Lang) => {
    document.cookie = `sfa_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex rounded-md border border-rule text-sm" role="group" aria-label="Language">
      <button type="button" onClick={() => set("zh")} aria-pressed={lang === "zh"} className={`rounded-l-md px-2 py-1 ${lang === "zh" ? "bg-ink text-sheet" : "text-ink-2 hover:bg-paper"}`}>
        中文
      </button>
      <button type="button" onClick={() => set("en")} aria-pressed={lang === "en"} className={`rounded-r-md px-2 py-1 ${lang === "en" ? "bg-ink text-sheet" : "text-ink-2 hover:bg-paper"}`}>
        EN
      </button>
    </div>
  );
}
