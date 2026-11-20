import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { currentActor } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { isAdmin } from "@/lib/auth";
import { SignInForm } from "./form";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const actor = await currentActor();
  if (actor && isAdmin(actor)) redirect("/admin");
  const lang = await currentLang();
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : undefined;
  return (
    <>
      <Header actor={null} lang={lang} />
      <main className="mx-auto max-w-[440px] px-4 py-16">
        <SignInForm lang={lang} next={next} linkError={sp.error === "link"} />
      </main>
    </>
  );
}
