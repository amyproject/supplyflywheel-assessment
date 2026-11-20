"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

export function DeleteCandidateButton({ lang, id, name }: { lang: Lang; id: string; name: string }) {
  const t = tr(lang);
  const [err, setErr] = useState("");
  return (
    <div>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={async () => {
          if (!confirm(t(`永久删除「${name}」及其全部答案、录音和评分？此操作无法撤销。`, `Permanently delete "${name}" and all their answers, recordings and scores? This can't be undone.`))) return;
          try {
            await api(`/api/admin/candidates/${id}`, { method: "DELETE" });
            window.location.href = "/admin";
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {t("删除候选人", "Delete candidate")}
      </button>
      {err ? <p className="mt-1 text-sm text-risk">{err}</p> : null}
    </div>
  );
}
