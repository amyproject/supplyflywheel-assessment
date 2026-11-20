import Link from "next/link";
import type { Actor } from "@/lib/auth";
import { isAdmin } from "@/lib/auth";
import { tr, type Lang } from "@/lib/i18n";
import { LangToggle } from "@/components/lang-toggle";
import { SignOutButton } from "@/components/sign-out";
import { Wordmark } from "@/components/wordmark";

export { Wordmark };

export function Header({ actor, lang, context, wide = false }: { actor: Actor | null; lang: Lang; context?: string; wide?: boolean }) {
  const t = tr(lang);
  return (
    <header className="border-b border-rule bg-sheet">
      <div className={`mx-auto flex h-14 items-center gap-4 px-4 sm:px-6 ${wide ? "max-w-[1440px]" : "max-w-[1180px]"}`}>
        <Wordmark href={actor ? (isAdmin(actor) ? "/admin" : "/candidate") : "/"} />
        {context ? <span className="hidden text-sm text-mute sm:inline">{context}</span> : null}
        <div className="ml-auto flex items-center gap-3">
          {actor && isAdmin(actor) ? (
            <nav className="hidden items-center gap-1 text-sm md:flex" aria-label={t("管理导航", "Admin navigation")}>
              <Link className="rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-paper" href="/admin">{t("候选人", "Candidates")}</Link>
              <Link className="rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-paper" href="/admin/compare">{t("对比", "Compare")}</Link>
              <Link className="rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-paper" href="/admin/assessments">{t("测评设置", "Assessment")}</Link>
              <Link className="rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-paper" href="/admin/settings">{t("链接与设置", "Link & settings")}</Link>
            </nav>
          ) : null}
          <LangToggle lang={lang} />
          {actor ? <span className="hidden text-sm text-mute lg:inline">{actor.full_name}</span> : null}
          {actor && isAdmin(actor) ? <SignOutButton label={t("退出", "Sign out")} /> : null}
        </div>
      </div>
    </header>
  );
}
