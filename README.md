# SupplyFlywheel — Robotics Supply Chain Lead Assessment

Chinese-first (中文 / EN toggle) **30-minute** timed case interview built from
`../supplyflywheel_candidate_assessment_prd.md`. **Candidates don't log in**: they open `/start`, enter
name + email, accept the notices and begin (one attempt per email; a private HMAC resume link lets them
reconnect or switch devices; optional admin-set access code). Only admins sign in, at `/auth/sign-in`,
to see every result: answers, recordings, machine + corrected transcripts, 1–5 scoring, compare, CSV.

## Run it

```bash
npm install
cp .env.example .env.local   # set SESSION_SECRET, ADMIN_PASSWORD, optional OPENAI_API_KEY
npm run seed                 # first super admin
npm run dev                  # http://localhost:3230
npm test                     # 29 unit/security tests
bash tools/e2e.sh /path/to/mandarin.wav   # HTTP smoke against the running dev server (deletes its test candidates afterwards)
```

Admin sign-in: `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local`. The candidate link is
`APP_BASE_URL/start` (copy it from **/admin/settings**, where you can also set an access code).
Defaults: 30-minute cap, auto-submit saved answers at the cap, 1.5 min per-question target; change them
at **/admin/assessments** (publishes a new version; started tests keep theirs).

## What's built (PRD mapping)

| PRD | Where |
|---|---|
| Roles, server-side authz (§2, §12) | `src/lib/auth.ts`, every API via `route()` in `src/lib/api.ts`; owner checks in `ownAttempt()` return 404 for foreign IDs |
| No-login start → separate recording consent → resume link (§3, changed per request) | `/start`, `/api/public/start`, `/resume/[token]`; a passwordless candidate record + session cookie keeps all owner checks |
| Timed question UI, autosave every 10 s + on blur/unload, idempotent (§8) | `/candidate/assessment/[id]`; `saveAnswer()` uses `rev` for text and `seq` + clamped deltas for active time |
| Server-authoritative timers, wall clock keeps running, hard cap / auto-submit configurable, extensions with reason (§8) | `startAttempt`, `refreshExpiry`, `extendAttempt` |
| Voice: MediaRecorder with MIME negotiation, pause/resume/stop/play/delete, 1 s chunks kept on interruption, upload retries, 25 MB / 15 min limits, magic-byte check (§7) | `recorder.tsx`, `src/lib/recordings.ts` |
| Mandarin STT via server-side provider adapter, async queue + retry, raw vs corrected transcript stored separately (§7) | `src/lib/transcribe.ts` (OpenAI `gpt-4o-mini-transcribe`) |
| Private audio, signed 5-minute URLs bound to user + session, Range streaming, play/download audited (§7, §12) | `/api/media/[id]` |
| Scoped copy/select/paste deterrents, IME untouched, accommodation requests, minimal integrity events, disclosed limits (§9) | `.protected` blocks, `blockPaste`, `/api/attempts/[id]/accommodations` |
| Admin dashboard: search, status/score filters, progress, time, score, band; CSV (summary + all answers, formula-injection safe) (§3, §15) | `/admin`, `/api/admin/exports/csv` |
| Per-question scoring 1–5 + private notes, live weighted total, provisional vs final, multi-reviewer averaging (§6) | `/admin/attempts/[id]`, `src/lib/scoring.ts` |
| Compare candidates, reopen/extend/archive, delete candidate (with files), paste accommodation, audit log, admin accounts, retention purge | `/admin/compare`, `/admin/settings` |
| Template versioning + snapshot per attempt (§12.10) | `/admin/assessments`, `publishTemplateSettings` |
| SQL migrations + RLS (§18) | `src/lib/db.ts` (SQLite, used locally) and `supabase/migrations/001_init.sql` (Postgres/RLS/Storage, **not yet applied to a live project**) |

## Deploying (and logging in as admin)

The admin account is **not** in git. On the host (Railway, Render, Fly, any Docker host) set:

| Variable | Value |
|---|---|
| `ADMIN_EMAIL` | the admin login email, e.g. `admin@supplyflywheel.dev` |
| `ADMIN_PASSWORD` | 12+ characters. On every start the app makes sure this super admin exists **with this password**, so changing it and redeploying resets the login |
| `APP_BASE_URL` | the public URL, e.g. `https://assess.example.com` (used in the test link and resume links) |
| `OPENAI_API_KEY` | optional; enables Mandarin speech-to-text |
| `DATABASE_PATH`, `STORAGE_DIR` | point both at a **persistent volume** (the Dockerfile uses `/data`). Without one, every redeploy erases all results |
| `SESSION_SECRET` | optional; otherwise generated once and stored in the database |

Then open `APP_BASE_URL/auth/sign-in`. Serverless hosts without a writable persistent disk (e.g. Vercel)
can't keep the SQLite database; use a host with a volume, or move to Supabase via `supabase/migrations/001_init.sql`.

Before real candidates: run `npm test`, `npm run build`, and `tools/e2e.sh` against staging; if candidates
are in mainland China, test reachability of the site, uploads and STT from real mainland networks.

## Known limits

- Browser deterrents can't stop screenshots, photos, devtools or a second device. Say so; don't rely on them.
- Recordings upload as one file after "stop" (chunks are buffered client-side), not resumable mid-upload.
- No MFA yet for admins (recommended by the PRD); sessions are 14-day httpOnly cookies.
- Live microphone recording was not exercised in a real browser here (no Chromium in this environment);
  the upload/transcribe/playback path was verified over HTTP with a real Mandarin WAV.
