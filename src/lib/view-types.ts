/** Shape of candidateView() as sent to the browser. */
export interface CandidateRecording {
  id: string;
  duration_seconds: number;
  mime_type: string;
  transcription_status: "none" | "queued" | "processing" | "done" | "failed" | "unavailable";
  transcription_error: string | null;
}
export interface CandidateAnswer {
  question_code: string;
  typed_text: string;
  machine_transcript: string | null;
  corrected_transcript: string | null;
  active_duration_seconds: number;
  rev: number;
  saved_at: string | null;
  answered: boolean;
  recording: CandidateRecording | null;
}
export interface CandidateViewData {
  attempt: {
    id: string;
    status: string;
    started_at: string;
    submitted_at: string | null;
    deadline_at: string | null;
    total_active_seconds: number;
    current_question_code: string | null;
    heartbeat_seq: number;
    recording_consent: boolean;
    paste_allowed: boolean;
    editable: boolean;
    resume_url: string;
  };
  settings: {
    title: string;
    version: number;
    recommended_seconds: number;
    overall_limit_seconds: number | null;
    auto_submit_on_expiry: boolean;
    copy_restriction_enabled: boolean;
    paste_restriction_enabled: boolean;
    allow_navigation: boolean;
  };
  scenario: { title_zh: string; title_en: string; body_zh: string; body_en: string; facts_zh: string[]; facts_en: string[]; note_zh: string; note_en: string };
  categories: { code: string; name_zh: string; name_en: string }[];
  questions: { code: string; category: string; order: number; prompt_zh: string; prompt_en: string; soft_limit_seconds: number }[];
  answers: CandidateAnswer[];
  server_now: string;
}
