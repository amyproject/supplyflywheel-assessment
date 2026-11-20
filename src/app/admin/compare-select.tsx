"use client";
import { useRef, useState } from "react";
import { tr, type Lang } from "@/lib/i18n";

/** Wraps the table; tracks checked rows and offers a compare link. */
export function CompareSelect({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const t = tr(lang);
  const ref = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<string[]>([]);
  return (
    <div
      ref={ref}
      onChange={() => {
        const checked = [...(ref.current?.querySelectorAll<HTMLInputElement>('input[name="cmp"]:checked') ?? [])].map((i) => i.value);
        setIds(checked.slice(0, 6));
      }}
    >
      {children}
      {ids.length >= 2 ? (
        <div className="toast-in fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-[460px] items-center gap-3 rounded-[var(--radius-md)] bg-ink p-3 pl-5 text-sheet shadow-lg">
          <span>{t(`已选 ${ids.length} 位`, `${ids.length} selected`)}</span>
          <a className="btn btn-primary btn-sm ml-auto" href={`/admin/compare?ids=${ids.join(",")}`}>{t("对比候选人", "Compare")}</a>
        </div>
      ) : null}
    </div>
  );
}
