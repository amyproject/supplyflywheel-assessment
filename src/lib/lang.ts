import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, asLang, type Lang } from "@/lib/i18n";

export async function currentLang(): Promise<Lang> {
  return asLang((await cookies()).get(LANG_COOKIE)?.value);
}
