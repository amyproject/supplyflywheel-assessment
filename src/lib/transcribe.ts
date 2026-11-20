import "server-only";
import { config } from "@/lib/config";

export type TranscribeResult = { status: "done"; text: string; provider: string } | { status: "unavailable"; reason: string };

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/**
 * Speech-to-text provider adapter. Server-only: the API key never reaches the browser.
 * Add providers here (e.g. a mainland-hosted ASR) behind the same return type.
 */
export async function transcribeAudio(bytes: Buffer, mime: string): Promise<TranscribeResult> {
  if (config.transcribeProvider === "none") {
    return { status: "unavailable", reason: "未配置语音转写服务 / No speech-to-text provider configured" };
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `answer.${EXT[mime] ?? "webm"}`);
  form.append("model", config.transcribeModel);
  form.append("language", "zh");
  form.append("response_format", "json");
  form.append("prompt", "以下是普通话回答，内容涉及机器人供应链、BOM、MOQ、RFQ、谐波减速器、伺服电机、DFM、CAPA。请使用简体中文标点。");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`transcription HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { text?: string };
  return { status: "done", text: (json.text ?? "").trim(), provider: `openai:${config.transcribeModel}` };
}
