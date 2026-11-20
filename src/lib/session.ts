import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Actor, SESSION_COOKIE, actorFromToken, isAdmin } from "@/lib/auth";

/** Current actor for server components (memoized per request). */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  return actorFromToken(jar.get(SESSION_COOKIE)?.value);
});

export async function requireCandidatePage(next?: string): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect("/start");
  if (isAdmin(a)) redirect("/admin");
  return a;
}

export async function requireAdminPage(next?: string): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect(`/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (!isAdmin(a)) redirect(`/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return a;
}
