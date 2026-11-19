# AI call recordings + transcripts (Call logs) — design

**Date:** 19 Nov 2026 · **Asked by:** operator (for Meny) · **Status:** draft for approval

## Why

Meny trains the voice agents (Voizo scripts). To improve a script he needs to hear the real calls our app places and
read what was said, and keep copies. Voizo has recordings and transcripts, but our calls go through Voizo's
**shadow API test campaigns**, deliberately kept out of Voizo's dashboard and daily reports. Those reports are where
Meny assesses Voizo's own recordings, and **ours must never be mixed in**.

## Goals

- Every AI call our app places gets, in our app: a ▶ player for the recording, the transcript, and **Download (.mp3 or
  whatever Vapi gives)** + **Download transcript (.txt)**.
- A **Call logs** page (Outreach → Call logs) lists all our AI calls for review: date, business, number dialled (marks a
  test number), voice agent, result, length; open one to play / read / download.
- The same player + transcript on the lead's history (CRM side panel call row).
- Recordings are kept in **our own** storage, because Vapi deletes them after 14 days.

## Non-goals / anti-goals

- **Voizo is not touched.** No code change, no deploy, no new endpoint there. Nothing we do may show up in Voizo's
  dashboard, reports or recording archive.
- No change to how calls are placed, gated or routed.
- No AI scoring of calls, no bulk zip export (later, if asked).
- Script Builder test calls (browser calls inside Voizo) are not pulled in: they live in Voizo.

## Constraints

- Voizo's Dial API gives us the transcript (`?include=transcript`, already saved to `call_attempts.transcript`) and the
  call's **Vapi call id** (`vapiCallId`, already saved to `call_attempts.meta.vapi_call_id`), but **not the audio**.
- Vapi: `GET https://api.vapi.ai/call/{id}` with the private key returns the call's `artifact` with presigned recording
  links (`presignedMonoUrl` / `presignedStereoUrl` / `recording.mono.combinedUrl` / `recordingUrl`), valid ~30 min.
  Recordings exist for 14 days. The recording may not be ready for a minute or two after the call ends.
- Key: the operator provides the **private API key of the Vapi account Voizo dials through**, read-only use. Env name
  **`VAPI_API_KEY`** (already in `.env` from the removed voice feature, read by no code today — verified). Needed on
  **Cloud Run** (where the call worker runs). Not needed on Vercel. Empty = recordings skipped, transcripts still work.
- Golden rules: Vapi calls only in `lib/services/vapi.ts` (retry + log), thin routes, dumb client, required headers.
- Paid calls: Vapi metadata GETs are free; audio download is egress only. Storage ≈ 1–3 MB per call (Supabase free
  tier 1 GB ≈ 500 calls) — fine for testing volume.

## Approaches considered

1. **Transcripts only** — free, no key, no audio. Rejected by the operator: audio is needed to train.
2. **Add a recording endpoint to Voizo** — rejected by the operator: Voizo stays untouched and separate.
3. **Read recordings straight from Vapi with the account's key, copy into our storage** — **chosen**. Keeps Voizo
   untouched and our calls only in our app.

## How it works

**Capture (Cloud Run, call worker, MODE=call):**
- When a call is finalized and it has a Vapi call id: ask Vapi for the call, take the first available recording link,
  download it, upload it to a **private** Supabase Storage bucket `call-recordings` at `<call_attempt id>.<ext>` (bucket
  created by code on first use, like `lib/clients/assets.ts`), and save the object path in
  `call_attempts.recording_url` (existing column). Never throws; a failure only means "not yet".
- Each call tick also sweeps a few (≤ 10) finished calls from the last 13 days that have a Vapi id but no saved
  recording (not ready yet, or a failed try) and retries them. After 13 days, stop trying: record
  `meta.recording_state = 'lost'`.
- At dial time, also save the voice agent used (`meta.voizo_campaign_id`) on the call record, so Call logs can show
  which agent made each call. Older calls show "—".

**Play / download (Vercel):**
- `GET /api/calls/:attemptId/recording` → a short-lived signed link (1 h) to the stored file; `?download=1` returns a
  signed link that downloads as `<business>-<yyyy-mm-dd>.<ext>`. 404 + plain message when there's no recording.
- The transcript is already in the call record; the page shows it and downloads it as a `.txt` (business, date,
  number, agent, result, then the transcript).
- No recording yet → "Recording not ready yet (fetched within 15 min of the call)"; no key → "Recordings are off
  (no Vapi key)"; older than 14 days and never fetched → "Recording expired at Vapi".

**Call logs page** (`/call-logs`, nav Outreach → Call logs): newest first, 50 per page, filters: agent, result,
date range, "test numbers only". Row click opens the player + transcript + both downloads.

**Lead history:** the CRM panel's AI call row gets "Listen" and "Transcript" that open the same viewer.

## Calls settled after the builder check (my calls, operator can overrule)

- **Unproven until the first real call:** no shadow-campaign call has a saved Vapi id yet (the worker that saves it
  isn't redeployed), so whether the key can read our calls' recordings is confirmed on the first test call. Parsing
  is defensive: no `artifact` / no recording link → `meta.recording_state = 'none_at_vapi'`, shown as "Vapi has no
  recording for this call". Wrong account / bad key (401/404) → `'no_access'`, shown as "Recordings are off: the Vapi
  key can't read this call", and logged once per tick, not per call.
- **Test number:** saved at dial time as `meta.test_number = true` when the dialled number came from
  `campaign_leads.call_phone`; older calls fall back to "dialled number ≠ the lead's phone" (E.164-normalised).
- **Which calls are listed:** every `call_attempts` row with `provider = 'voizo'` (they're all dialled; refused dials
  never get a row). Rows with no conversation (failed, no answer) show their result and "No recording / transcript".
- **Agent shown:** a name snapshot saved at dial time (`meta.agent_name`, plus `meta.voizo_campaign_id`); no agent
  picked → "Voizo default"; older calls → "—". The agent filter lists the names seen on calls.
- **Retry sweep placement:** runs at the start of every call tick, before the early exits (empty queue, outside hours,
  campaign not shadow, a call still live), so a recording is fetched within 15 min even when nothing is dialled.
- **Who can open recordings:** the dashboard has no login today (every page and API is open to whoever has the URL;
  same exposure as lead emails and phones). Recording links are signed, 1 h, per call id. Adding a dashboard login is
  separate work, flagged to the operator.

## Left to the builder

File layout, component names, page styling (match Templates / Voice agents pages), how the viewer is shared between
Call logs and the CRM panel, Vapi response parsing details, tests per golden rules (pure helpers: pick the recording
link, file name, transcript `.txt` text, recording state message).

## Operator to-dos after build

- Put the Vapi key in `.env` as `VAPI_API_KEY`, add it to the Cloud Run job, redeploy Cloud Run.
- One test call to confirm a recording lands.
