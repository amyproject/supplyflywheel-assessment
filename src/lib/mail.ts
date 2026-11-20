import "server-only";
import { config } from "@/lib/config";

/** Transactional email via Resend when configured; otherwise returns false and callers show the link to the admin instead. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.resendKey || !config.emailFrom) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
