"use client";
import { useRef, useState } from "react";
import { tr, type Lang } from "@/lib/i18n";

/**
 * Best-effort copy/cut/paste/drag/context-menu block for assessment content, with a gentle notice and a
 * minimal integrity event. Keyboard navigation, screen readers and IME input are untouched.
 */
export function ProtectedArea({ lang, attemptId, enabled = true, children }: { lang: Lang; attemptId: string; enabled?: boolean; children: React.ReactNode }) {
  const t = tr(lang);
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const block = (kind: string, text: string) => (e: React.SyntheticEvent) => {
    if (!enabled) return;
    e.preventDefault();
    setMsg(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), 4000);
    void fetch(`/api/attempts/${attemptId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ type: kind, meta: { page: "review" } }] }),
    }).catch(() => {});
  };
  const noCopy = t("测评内容不支持复制。", "Assessment content can't be copied.");
  return (
    <div
      className={enabled ? "protected" : ""}
      onCopy={block("copy_blocked", noCopy)}
      onCut={block("cut_blocked", noCopy)}
      onContextMenu={block("contextmenu_blocked", noCopy)}
      onPaste={block("paste_blocked", t("本测评不支持粘贴。", "Pasting is turned off for this assessment."))}
      onDrop={block("drop_blocked", t("本测评不支持粘贴。", "Pasting is turned off for this assessment."))}
      onDragStart={enabled ? (e) => e.preventDefault() : undefined}
    >
      {children}
      {msg ? (
        <div className="toast-in fixed inset-x-4 bottom-4 z-30 mx-auto max-w-[480px] rounded-[var(--radius-md)] bg-ink p-4 text-sheet shadow-lg" role="status">
          {msg}
        </div>
      ) : null}
    </div>
  );
}
