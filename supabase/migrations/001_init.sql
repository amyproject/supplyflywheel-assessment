-- SupplyFlywheel assessment: Postgres schema + Row Level Security for a Supabase deployment.
-- The local app runs on SQLite with the same logical schema (src/lib/db.ts) and enforces the same rules
-- in server code. This file is the production path from PRD §10–§12. It has NOT been applied to a live
-- Supabase project yet; run it in a staging project and exercise tests/security.test.ts-style checks first.

create type user_role as enum ('candidate', 'admin', 'super_admin');
create type attempt_status as enum ('in_progress', 'submitted', 'expired', 'reopened');

create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null references auth.users(id) on delete cascade,
  role user_role not null default 'candidate',
  full_name text not null,
  email text not null unique,
  phone text,
  location text,
  created_at timestamptz not null default now()
);

create table assessment_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  version int not null,
  language text not null default 'zh-CN',
  scenario jsonb not null,
  categories jsonb not null,
  recommended_seconds int not null default 5400,
  overall_limit_seconds int,
  auto_submit_on_expiry boolean not null default false,
  copy_restriction_enabled boolean not null default true,
  paste_restriction_enabled boolean not null default true,
  allow_navigation boolean not null default true,
  published_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references assessment_templates(id) on delete cascade,
  question_code text not null,
  category text not null,
  display_order int not null,
  prompt_zh text not null,
  prompt_en text not null,
  rubric_zh text not null,
  rubric_en text not null,
  category_weight int not null,
  soft_limit_seconds int not null default 240,
  hard_limit_seconds int,
  unique (template_id, question_code)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  template_id uuid not null references assessment_templates(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  candidate_id uuid references profiles(id),
  revoked_at timestamptz,
  last_sent_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table attempts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references profiles(id),
  template_id uuid not null references assessment_templates(id),
  invitation_id uuid unique references invitations(id),
  status attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  last_active_at timestamptz not null default now(),
  deadline_at timestamptz,
  extension_seconds int not null default 0,
  total_active_seconds int not null default 0,
  heartbeat_seq int not null default 0,
  heartbeat_at timestamptz,
  current_question_code text,
  consent_terms_at timestamptz not null,
  consent_recording_at timestamptz,
  paste_accommodation boolean not null default false,
  template_snapshot jsonb not null,
  archived_at timestamptz
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  question_code text not null,
  typed_text text not null default '',
  machine_transcript text,
  transcript_provider text,
  corrected_transcript text,
  first_opened_at timestamptz,
  last_left_at timestamptz,
  active_duration_seconds int not null default 0,
  recording_duration_seconds int not null default 0,
  rev bigint not null default 0,
  saved_at timestamptz,
  submitted_at timestamptz,
  unique (attempt_id, question_code)
);

create table recordings (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references answers(id) on delete cascade,
  attempt_id uuid not null references attempts(id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  bytes int not null check (bytes > 0 and bytes <= 26214400),
  duration_seconds int not null check (duration_seconds between 0 and 900),
  transcription_status text not null default 'none'
    check (transcription_status in ('none','queued','processing','done','failed','unavailable')),
  transcription_error text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  question_code text not null,
  reviewer_id uuid not null references profiles(id),
  score int check (score between 1 and 5),
  private_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_code, reviewer_id)
);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  question_code text,
  event_type text not null,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create table accommodation_requests (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  kind text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','granted','declined')),
  created_at timestamptz not null default now(),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz
);

create table admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

-- ---------- helpers (role comes from the database, never from client JWT metadata) ----------
create or replace function public.current_profile_id() returns uuid
  language sql stable security definer set search_path = public as
  $$ select id from profiles where auth_user_id = auth.uid() $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from profiles where auth_user_id = auth.uid() and role in ('admin','super_admin')) $$;

create or replace function public.owns_open_attempt(a uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from attempts where id = a and candidate_id = current_profile_id()
                    and status in ('in_progress','reopened') and archived_at is null) $$;

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table assessment_templates enable row level security;
alter table questions enable row level security;
alter table invitations enable row level security;
alter table attempts enable row level security;
alter table answers enable row level security;
alter table recordings enable row level security;
alter table reviews enable row level security;
alter table activity_events enable row level security;
alter table accommodation_requests enable row level security;
alter table admin_audit_logs enable row level security;

create policy profiles_self on profiles for select using (auth_user_id = auth.uid() or is_admin());
create policy profiles_self_update on profiles for update using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid() and role = (select role from profiles p where p.auth_user_id = auth.uid()));

-- Templates/questions (including rubrics) are admin-only; candidates read their attempt's template_snapshot,
-- which the server strips of rubrics before sending (see candidateView).
create policy templates_admin on assessment_templates for all using (is_admin()) with check (is_admin());
create policy questions_admin on questions for all using (is_admin()) with check (is_admin());
create policy invitations_admin on invitations for all using (is_admin()) with check (is_admin());

create policy attempts_candidate_read on attempts for select using (candidate_id = current_profile_id() or is_admin());
create policy attempts_admin_write on attempts for update using (is_admin()) with check (is_admin());
-- Candidates start/submit attempts through server routes (service role), so timestamps stay server-side.

create policy answers_read on answers for select
  using (is_admin() or exists (select 1 from attempts a where a.id = attempt_id and a.candidate_id = current_profile_id()));
create policy answers_candidate_update on answers for update
  using (owns_open_attempt(attempt_id)) with check (owns_open_attempt(attempt_id));

create policy recordings_read on recordings for select
  using (is_admin() or exists (select 1 from attempts a where a.id = attempt_id and a.candidate_id = current_profile_id()));
create policy recordings_candidate_insert on recordings for insert with check (owns_open_attempt(attempt_id));

-- Reviews and audit logs are never visible to candidates.
create policy reviews_admin on reviews for all using (is_admin()) with check (is_admin() and reviewer_id = current_profile_id());
create policy audit_admin_read on admin_audit_logs for select using (is_admin());
create policy events_admin_read on activity_events for select using (is_admin());
create policy events_candidate_insert on activity_events for insert with check (owns_open_attempt(attempt_id));
create policy acc_read on accommodation_requests for select
  using (is_admin() or exists (select 1 from attempts a where a.id = attempt_id and a.candidate_id = current_profile_id()));
create policy acc_candidate_insert on accommodation_requests for insert with check (owns_open_attempt(attempt_id));
create policy acc_admin_update on accommodation_requests for update using (is_admin()) with check (is_admin());

-- ---------- Storage: private bucket, path = <attempt_id>/<recording_id>.<ext> ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 26214400,
        array['audio/webm','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/mpeg','audio/wav','audio/x-wav'])
on conflict (id) do nothing;

create policy rec_upload_own on storage.objects for insert
  with check (bucket_id = 'recordings' and owns_open_attempt(((storage.foldername(name))[1])::uuid));
create policy rec_read_admin on storage.objects for select
  using (bucket_id = 'recordings' and is_admin());
-- Playback for admins goes through createSignedUrl(path, 300) from the server; the bucket is never public.
