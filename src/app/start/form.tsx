"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { tr, type Lang } from "@/lib/i18n";

interface Props {
  lang: Lang;
  adminSignedIn: boolean;
  needsCode: boolean;
  settings: { recommended_minutes: number; limit_minutes: number | null; soft_seconds: number; auto_submit: boolean; copy: boolean; paste: boolean; questions: number };
  stt: string | null;
}

export function StartForm({ lang, adminSignedIn, needsCode, settings, stt }: Props) {
  const t = tr(lang);
  const [p, setP] = useState({ full_name: "", email: "", phone: "", location: "", access_code: "" });
  const [terms, setTerms] = useState(false);
  const [rec, setRec] = useState(false);
  const [mic, setMic] = useState<"idle" | "testing" | "ok" | "denied" | "unsupported">("idle");
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);

  async function testMic() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setMic("unsupported");
    setMic("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopRef.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((x) => x.stop());
        void ctx.close();
      };
      setTimeout(() => {
        stopRef.current();
        setMic("ok");
      }, 4000);
    } catch {
      setMic("denied");
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ redirect: string }>("/api/public/start", {
        body: { full_name: p.full_name, email: p.email, phone: p.phone || null, location: p.location || null, access_code: needsCode ? p.access_code : null, consent_terms: terms, consent_recording: rec },
      });
      window.location.href = r.redirect;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const perQ = settings.soft_seconds >= 120 ? t(`${Math.round(settings.soft_seconds / 60)} 分钟`, `${Math.round(settings.soft_seconds / 60)} minutes`) : t(`${settings.soft_seconds / 60} 分钟`, `${settings.soft_seconds / 60} minutes`);

  return (
    <form onSubmit={start} className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{t("开始测评", "Start the assessment")}</h1>
        <p className="mt-2 text-ink-2">{t(`无需注册。填写信息、阅读说明后即可开始，共 ${settings.recommended_minutes} 分钟。计时从点击「开始测评」起。`, `No account needed. Fill in your details, read the instructions and begin: ${settings.recommended_minutes} minutes in total. The clock starts when you press Start.`)}</p>
      </div>
      {adminSignedIn ? <p className="rounded-md bg-watch-wash p-4 text-watch">{t("您当前以管理员身份登录。参加测评前请先退出。", "You're signed in as an admin. Sign out before taking the test.")}</p> : null}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">{t("1. 个人信息", "1. Your details")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">{t("姓名（必填）", "Full name (required)")}</span>
            <input className="field mt-1" required maxLength={100} autoComplete="name" value={p.full_name} onChange={(e) => setP({ ...p, full_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">{t("邮箱（必填，用于联系您）", "Email (required, so we can reach you)")}</span>
            <input className="field mt-1" type="email" required maxLength={200} autoComplete="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">{t("手机/微信（可选）", "Phone / WeChat (optional)")}</span>
            <input className="field mt-1" maxLength={40} autoComplete="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">{t("所在城市", "City")}</span>
            <input className="field mt-1" maxLength={100} value={p.location} placeholder={t("如：深圳", "e.g. Shenzhen")} onChange={(e) => setP({ ...p, location: e.target.value })} />
          </label>
          {needsCode ? (
            <label className="block sm:col-span-2">
              <span className="label">{t("测评口令（由招聘方提供）", "Access code (from the recruiter)")}</span>
              <input className="field mt-1" required maxLength={100} value={p.access_code} onChange={(e) => setP({ ...p, access_code: e.target.value })} autoComplete="off" />
            </label>
          ) : null}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">{t("2. 测评说明", "2. How it works")}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-2">
          <li>{t(`共 ${settings.questions} 道案例题，总时长 ${settings.recommended_minutes} 分钟，每题建议约 ${perQ}。抓住要点即可，不必面面俱到。`, `${settings.questions} case questions in ${settings.recommended_minutes} minutes, about ${perQ} each. Hit the key points; you don't need to be exhaustive.`)}</li>
          <li>
            {settings.limit_minutes
              ? t(`${settings.limit_minutes} 分钟后测评结束。计时按真实时间计算，关闭页面后仍会继续。`, `The test ends after ${settings.limit_minutes} minutes. The clock is wall-clock time and keeps running if you close the page.`)
              : t("没有硬性时限；计时按真实时间计算。", "No hard cap; the clock is wall-clock time.")}
            {settings.limit_minutes ? (settings.auto_submit ? t(" 时间到时，已保存的答案会自动提交。", " When time is up, your saved answers are submitted automatically.") : t(" 时间到时答案锁定，您仍可提交已保存内容。", " When time is up, answers lock; you can still submit what was saved.")) : null}
          </li>
          <li>{t("每题可打字、录音，或两者都用。答案每10秒自动保存。开始后您会获得一个私人续答链接，可在断网或换设备后继续。", "Type, record, or both. Answers save every 10 seconds. After you start you get a private resume link for reconnecting or switching devices.")}</li>
          <li>{t("每个邮箱只能参加一次。提交后答案锁定。", "One attempt per email. Submitting locks your answers.")}</li>
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">{t("3. 测评诚信说明", "3. Assessment integrity")}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-2">
          {settings.copy ? <li>{t("题目区域不支持选中和复制。", "Question text can't be selected or copied.")}</li> : null}
          {settings.paste ? <li>{t("答题框不支持粘贴，请直接输入或录音。", "Pasting into answer boxes is turned off; type or record your answers.")}</li> : null}
          <li>{t("我们会记录复制/粘贴尝试与切换标签页等少量事件，仅供人工评审参考，绝不会据此自动淘汰。", "We log a few events, such as copy/paste attempts and tab switches, for human reviewers only. They never reject anyone automatically.")}</li>
          <li>{t("这些限制无法阻止截图或拍照，我们也不使用摄像头或屏幕监控。", "These limits can't stop screenshots or photos, and we don't use camera or screen monitoring.")}</li>
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">{t("4. 隐私与录音", "4. Privacy and recording")}</h2>
        <div className="mt-3 space-y-2 text-ink-2">
          <p>{t("您的信息与答案仅 SupplyFlywheel 授权招聘人员可查看。录音保存在私有存储中，通过短时有效链接收听，每次访问都会记录。", "Your details and answers are visible only to authorized SupplyFlywheel recruiters. Recordings live in private storage, are played through short-lived links, and each access is logged.")}</p>
          <p>
            {stt
              ? t(`如您选择语音转文字，录音将发送至 ${stt} 进行自动转写。转写结果标注为机器生成，您可以修改；原始录音单独保留。`, `If you choose speech-to-text, the audio is sent to ${stt}. Transcripts are labelled machine-generated and you can correct them; the original audio is kept separately.`)
              : t("当前未启用自动转写，录音仅供人工收听。", "Automatic transcription isn't enabled; recordings are for human listening only.")}
          </p>
          <p>{t("测评资料默认保留365天，之后删除。您可随时联系招聘方申请查阅或删除。评分由人工完成，系统不会做出自动招聘决定。", "Data is kept 365 days by default, then deleted. You can ask the recruiter to access or delete it. People do the scoring; no hiring decision is automated.")}</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-md border border-rule p-4">
          <button type="button" className="btn btn-quiet btn-sm" onClick={testMic} disabled={mic === "testing"}>
            {mic === "testing" ? t("请说几句话…", "Say a few words…") : t("测试麦克风（可选）", "Test microphone (optional)")}
          </button>
          {mic === "testing" ? (
            <div className="h-2 w-40 overflow-hidden rounded bg-paper" aria-hidden="true">
              <div className="h-full origin-left bg-signal" style={{ transform: `scaleX(${level})` }} />
            </div>
          ) : null}
          <span className="text-sm text-mute" role="status">
            {mic === "ok" ? t("麦克风可用。", "Microphone works.") : mic === "denied" ? t("麦克风权限被拒绝，您仍可打字作答。", "Microphone permission denied. You can still type.") : mic === "unsupported" ? t("此浏览器不支持录音，您仍可打字作答。", "This browser can't record. You can still type.") : ""}
          </span>
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[var(--color-signal)]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>{t("我已阅读并同意以上测评说明、诚信说明与隐私声明。（必选）", "I've read and accept the instructions, integrity notice and privacy notice. (Required)")}</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[var(--color-signal)]" checked={rec} onChange={(e) => setRec(e.target.checked)} />
          <span>{t("我同意录制我的语音回答，并按上述方式存储与转写。（可选，不同意也可打字作答）", "I consent to recording my spoken answers, stored and transcribed as described. (Optional; you can type instead)")}</span>
        </label>
        {err ? <p className="text-sm text-risk" role="alert">{err}</p> : null}
        <div className="pt-2">
          <button className="btn btn-primary" disabled={!terms || busy || adminSignedIn}>
            {busy ? t("正在开始…", "Starting…") : t(`开始测评（${settings.recommended_minutes} 分钟）`, `Start (${settings.recommended_minutes} minutes)`)}
          </button>
        </div>
      </section>
    </form>
  );
}
