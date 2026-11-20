import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { currentActor } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { accessCodeRequired, candidateAttempts, currentTemplate } from "@/lib/assessment";
import { isAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { tr } from "@/lib/i18n";
import { StartForm } from "./form";

export const dynamic = "force-dynamic";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await currentActor();
  const lang = await currentLang();
  const t = tr(lang);
  // A candidate who already started in this browser goes straight back to their test.
  if (actor && !isAdmin(actor)) {
    const open = candidateAttempts(actor.id)[0];
    if (open) redirect(open.status === "submitted" ? `/candidate/submitted?attempt=${open.id}` : `/candidate/assessment/${open.id}`);
  }
  const tpl = currentTemplate();
  const sp = await searchParams;
  return (
    <>
      <Header actor={actor && isAdmin(actor) ? actor : null} lang={lang} context={t("测评说明", "Instructions")} />
      <main className="mx-auto max-w-[820px] px-4 py-10">
        {sp.error === "resume" ? <p className="mb-6 rounded-md bg-watch-wash p-4 text-watch" role="alert">{t("续答链接无效。", "That resume link isn't valid.")}</p> : null}
        <StartForm
          lang={lang}
          adminSignedIn={!!actor && isAdmin(actor)}
          needsCode={accessCodeRequired()}
          settings={{
            recommended_minutes: Math.round(tpl.recommended_seconds / 60),
            limit_minutes: tpl.overall_limit_seconds ? Math.round(tpl.overall_limit_seconds / 60) : null,
            soft_seconds: tpl.questions[0]?.soft_limit_seconds ?? 90,
            auto_submit: tpl.auto_submit_on_expiry,
            copy: tpl.copy_restriction_enabled,
            paste: tpl.paste_restriction_enabled,
            questions: tpl.questions.length,
          }}
          stt={config.transcribeProvider === "openai" ? "OpenAI (美国 / United States)" : null}
        />
      </main>
    </>
  );
}
