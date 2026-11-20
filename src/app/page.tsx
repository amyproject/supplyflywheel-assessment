import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { currentActor } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { isAdmin } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { CATEGORIES, SCENARIO } from "@/lib/questions";

export default async function Landing() {
  const actor = await currentActor();
  if (actor) redirect(isAdmin(actor) ? "/admin" : "/start");
  const lang = await currentLang();
  const t = tr(lang);
  return (
    <>
      <Header actor={null} lang={lang} />
      <main className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <section className="grid gap-10 py-14 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:py-20">
          <div className="min-w-0">
            <h1 className="text-[2.4rem] font-semibold tracking-tight sm:text-[3.1rem]">{t("机器人供应链负责人测评", "Robotics Supply Chain Lead assessment")}</h1>
            <p className="mt-4 max-w-[34rem] text-lg text-ink-2">
              {t("30分钟结构化案例面试：19道题，可打字或用普通话语音作答。无需注册。", "A 30-minute structured case interview: 19 questions, answered by typing or speaking Mandarin. No account needed.")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/start" className="btn btn-primary">{t("开始测评", "Start the assessment")}</Link>
              <a href="#how" className="btn btn-quiet">{t("了解流程", "How it works")}</a>
            </div>
            <p className="mt-4 text-sm text-mute">{t("请预留30分钟不受打扰的时间，建议使用电脑。", "Set aside 30 uninterrupted minutes; a computer works best.")}</p>
          </div>
          <aside className="card min-w-0 p-6" aria-label={t("案例预览", "Case preview")}>
            <p className="label">{t("案例", "The case")}</p>
            <h2 className="mt-1 text-lg font-semibold">{lang === "en" ? SCENARIO.title_en : SCENARIO.title_zh}</h2>
            <ul className="mt-4 space-y-2 text-[0.95rem] text-ink-2">
              {(lang === "en" ? SCENARIO.facts_en : SCENARIO.facts_zh).slice(0, 4).map((f) => (
                <li key={f} className="border-t border-rule pt-2">{f}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-mute">{lang === "en" ? SCENARIO.note_en : SCENARIO.note_zh}</p>
          </aside>
        </section>

        <section id="how" className="border-t border-rule py-14">
          <h2 className="text-2xl font-semibold">{t("五个维度，人工评分", "Five areas, scored by people")}</h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-5">
            {CATEGORIES.map((c) => (
              <div key={c.code} className="bg-sheet p-5">
                <p className="num text-3xl font-semibold text-signal">{c.weight}%</p>
                <p className="mt-2 font-medium">{lang === "en" ? c.name_en : c.name_zh}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <div>
              <h3 className="font-semibold">{t("随时保存", "Saved as you go")}</h3>
              <p className="mt-2 text-ink-2">{t("每10秒自动保存。私人续答链接让您断网或换设备后继续。", "Autosaves every 10 seconds. A private resume link lets you reconnect or switch devices.")}</p>
            </div>
            <div>
              <h3 className="font-semibold">{t("语音可选", "Voice is optional")}</h3>
              <p className="mt-2 text-ink-2">{t("录音前需单独同意；机器转写可由您本人修改。", "Recording needs separate consent; you can correct the machine transcript yourself.")}</p>
            </div>
            <div>
              <h3 className="font-semibold">{t("人工评审", "Human review")}</h3>
              <p className="mt-2 text-ink-2">{t("不会仅凭系统事件或口音、语速自动淘汰任何人。", "No one is rejected automatically on system events, accent or speaking speed.")}</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-2 px-4 py-6 text-sm text-mute sm:px-6">
          <span>SupplyFlywheel</span>
          <span>{t("案例数字均为虚构假设。", "All case numbers are fictional.")} <Link className="ml-3 underline" href="/auth/sign-in">{t("管理员登录", "Admin sign-in")}</Link></span>
        </div>
      </footer>
    </>
  );
}
