import { redirect } from "next/navigation";
import { requireCandidatePage } from "@/lib/session";
import { candidateAttempts } from "@/lib/assessment";

/** Candidates have one attempt; send them to wherever it stands. */
export default async function CandidateHome() {
  const actor = await requireCandidatePage("/candidate");
  const a = candidateAttempts(actor.id)[0];
  if (!a) redirect("/start");
  if (a.status === "submitted") redirect(`/candidate/submitted?attempt=${a.id}`);
  if (a.status === "expired") redirect(`/candidate/review/${a.id}`);
  redirect(`/candidate/assessment/${a.id}`);
}
