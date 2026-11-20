import "server-only";
import path from "node:path";

export const config = {
  get databasePath() {
    return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "assessment.db");
  },
  get storageDir() {
    return process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
  },
  get offline() {
    return process.env.ASSESS_OFFLINE === "1";
  },
  get transcribeProvider(): "openai" | "none" {
    if (this.offline) return "none";
    const p = process.env.TRANSCRIBE_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none");
    return p === "openai" && process.env.OPENAI_API_KEY ? "openai" : "none";
  },
  get transcribeModel() {
    return process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  },
  get appBaseUrl() {
    return (process.env.APP_BASE_URL || "http://localhost:3230").replace(/\/$/, "");
  },
  get resendKey() {
    return this.offline ? "" : process.env.RESEND_API_KEY || "";
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || "";
  },
  /** Recording limits (server-enforced). */
  maxRecordingBytes: 25 * 1024 * 1024,
  maxRecordingSeconds: 15 * 60,
  maxRecordingsPerAnswer: 12,
  signedUrlTtlSeconds: 300,
  sessionDays: 14,
  invitationDays: 14,
};
