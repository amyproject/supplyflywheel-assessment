import { notFound, redirect } from "next/navigation";
import { requireCandidatePage } from "@/lib/session";
import { currentLang } from "@/lib/lang";
import { candidateView } from "@/lib/assessment";
import { HttpError } from "@/lib/http";
import { config } from "@/lib/config";
import { AssessmentClient } from "./client";

export const dynamic = "force-dynamic";

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ attemptId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { attemptId } = await params;
  const { q } = await searchParams;
  const actor = await requireCandidatePage(`/candidate/assessment/${attemptId}`);
  const lang = await currentLang();
  let view;
  try {
    view = candidateView(actor, attemptId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  if (view.attempt.status === "submitted") redirect(`/candidate/submitted?attempt=${attemptId}`);
  if (!view.attempt.editable) redirect(`/candidate/review/${attemptId}`);
  if (q && view.settings.allow_navigation && view.questions.some((x) => x.code === q)) view.attempt.current_question_code = q;
  return <AssessmentClient lang={lang} initial={view} candidateName={actor.full_name} sttEnabled={config.transcribeProvider !== "none"} />;
}
