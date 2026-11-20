import Link from "next/link";
import { Header } from "@/components/header";
import { currentActor } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { invitationByToken } from "@/lib/assessment";
import { tr } from "@/lib/i18n";
import { AcceptForm } from "./form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lang = await currentLang();
  const t = tr(lang);
  const actor = await currentActor();
  const { invitation, state } = invitationByToken(token);
  return (
    <>
      <Header actor={actor} lang={lang} />
      <main className="mx-auto max-w-[520px] px-4 py-14">
        {state !== "valid" || !invitation ? (
          <div className="card p-7">
            <h1 className="text-2xl font-semibold">{t("邀请链接不可用", "This invitation can't be used")}</h1>
            <p className="mt-3 text-ink-2">
              {state === "accepted"
                ? t("该邀请已被接受，请直接登录。", "This invitation was already accepted. Please sign in.")
                : state === "expired"
                  ? t("该邀请已过期，请联系招聘方重新发送。", "This invitation has expired. Ask the recruiter to resend it.")
                  : t("链接无效或已撤销。", "The link is invalid or was revoked.")}
            </p>
            <Link href="/auth/sign-in" className="btn btn-primary mt-6">{t("去登录", "Go to sign in")}</Link>
          </div>
        ) : (
          <AcceptForm lang={lang} token={token} email={invitation.email} name={invitation.full_name} signedInAs={actor?.email ?? null} />
        )}
      </main>
    </>
  );
}
