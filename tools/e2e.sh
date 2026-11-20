#!/usr/bin/env bash
# End-to-end smoke over HTTP against a running dev server (npm run dev). Usage: bash tools/e2e.sh [audio.wav]
set -euo pipefail
B=${BASE:-http://localhost:3230}
AUDIO=${1:-/tmp/zh.wav}
ADMIN_PW=$(grep ^ADMIN_PASSWORD .env.local | cut -d= -f2)
J=/tmp/sfa-e2e; rm -rf $J; mkdir -p $J
j(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
post(){ local jar=$1 url=$2 body=$3; curl -sS -b $jar -c $jar -H "Origin: $B" -H 'Content-Type: application/json' -d "$body" "$B$url"; }
code(){ curl -s -o /dev/null -w '%{http_code}' -b $1 "$B$2"; }
EMAIL="e2e.$(date +%s)@example.com"

post $J/adm "/api/auth/sign-in" "{\"email\":\"admin@supplyflywheel.dev\",\"password\":\"$ADMIN_PW\"}" >/dev/null
echo "start page (no login): $(code $J/none /start)"
ST=$(post $J/cand "/api/public/start" "{\"full_name\":\"陈测试\",\"email\":\"$EMAIL\",\"location\":\"深圳\",\"consent_terms\":true,\"consent_recording\":true}"); echo "start: $ST"
ATT=$(echo "$ST" | j "d['id']")
echo "assessment page: $(code $J/cand /candidate/assessment/$ATT)"
echo "autosave: $(curl -sS -b $J/cand -H "Origin: $B" -X PATCH -H 'Content-Type: application/json' -d '{"rev":100,"typed_text":"先做需求澄清和BOM分析，再建立长名单。","seq":1,"active_delta":8,"opened":true}' $B/api/attempts/$ATT/answers/A1)"
echo "events: $(post $J/cand /api/attempts/$ATT/events '{"events":[{"type":"paste_blocked","question_code":"A1"},{"type":"visibility_hidden"}]}')"
REC=$(curl -sS -b $J/cand -H "Origin: $B" -F "file=@$AUDIO;type=audio/wav" -F question_code=A2 -F duration_seconds=14 $B/api/attempts/$ATT/recordings); echo "upload: $REC"
RID=$(echo "$REC" | j "d['id']")
echo "transcribe: $(curl -sS -b $J/cand -H "Origin: $B" -X POST $B/api/recordings/$RID/transcribe)"
for i in $(seq 1 40); do S=$(curl -sS -b $J/cand $B/api/recordings/$RID); st=$(echo "$S" | j "d['transcription_status']"); case $st in done|failed|unavailable) break;; esac; sleep 2; done
echo "$S" | python3 -c "import sys,json;d=json.load(sys.stdin);print('stt:',d['transcription_status'],d['transcription_error']);print('machine:',d['machine_transcript']);print('corrected:',d['corrected_transcript'])"
PLAY=$(echo "$S" | j "d['play_url']")
echo "candidate plays own audio: $(code $J/cand "$PLAY")"
# A second candidate must not see the first one's data
post $J/other "/api/public/start" "{\"full_name\":\"另一位\",\"email\":\"x$EMAIL\",\"consent_terms\":true,\"consent_recording\":false}" >/dev/null
printf '{"full_name":"x","email":"%s","consent_terms":true,"consent_recording":false}' "$EMAIL" > $J/hijack.json
echo "same email again (hijack attempt): $(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $B" -H 'Content-Type: application/json' --data-binary @$J/hijack.json $B/api/public/start)"
RES=$(curl -s -b $J/cand $B/api/attempts/$ATT | j "d['attempt']['resume_url']")
echo "resume link on a fresh browser: $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' -c $J/resumed "$RES")"
echo "resumed browser reads attempt: $(code $J/resumed /api/attempts/$ATT)"
echo "other candidate GET attempt: $(code $J/other /api/attempts/$ATT)  page: $(code $J/other /candidate/assessment/$ATT)  audio: $(code $J/other "$PLAY")  admin api: $(code $J/other /api/admin/candidates)"
echo "anonymous admin api: $(code $J/none /api/admin/candidates)  media: $(code $J/none "$PLAY")"
echo "submit: $(post $J/cand /api/attempts/$ATT/submit '{}')"
echo "submit again: $(post $J/cand /api/attempts/$ATT/submit '{}')"
echo "edit after submit: $(curl -s -o /dev/null -w '%{http_code}' -b $J/cand -H "Origin: $B" -X PATCH -H 'Content-Type: application/json' -d '{"rev":999999999999999,"typed_text":"x"}' $B/api/attempts/$ATT/answers/A1)"
echo "submitted page: $(code $J/cand "/candidate/submitted?attempt=$ATT")"
# Admin side
echo "admin attempt page: $(code $J/adm /admin/attempts/$ATT)"
printf '{"attempt_id":"%s","question_code":"A1","score":4,"private_notes":"思路清晰"}' "$ATT" > $J/rev.json
echo "review: $(curl -sS -b $J/adm -H "Origin: $B" -H 'Content-Type: application/json' --data-binary @$J/rev.json $B/api/admin/reviews | head -c 120)"
APLAY=$(curl -sS -b $J/adm $B/api/recordings/$RID | j "d['play_url']")
echo "admin plays audio: $(code $J/adm "$APLAY")  (range) $(curl -s -o /dev/null -w '%{http_code}' -b $J/adm -H 'Range: bytes=0-99' "$B$APLAY")"
echo "candidate URL used by admin: $(code $J/adm "$PLAY")"
for p in /admin /admin/candidates /admin/compare /admin/assessments /admin/settings "/admin/compare?ids=$ATT,$ATT"; do echo "admin $p: $(code $J/adm $p)"; done
curl -sS -b $J/adm "$B/api/admin/exports/csv" | head -3
echo "$ATT" > /tmp/e2e.att

# Clean up: delete the test candidates this run created.
for em in "$EMAIL" "x$EMAIL"; do
  CID=$(curl -sS -b $J/adm "$B/api/admin/candidates?q=$em" | python3 -c "import sys,json;r=json.load(sys.stdin)['rows'];print(r[0]['candidate_id'] if r else '')")
  [ -n "$CID" ] && echo "cleanup $em: $(curl -sS -b $J/adm -H "Origin: $B" -X DELETE $B/api/admin/candidates/$CID)"
done
