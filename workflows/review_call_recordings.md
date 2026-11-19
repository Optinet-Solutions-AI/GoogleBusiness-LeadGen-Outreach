# Review AI call recordings + transcripts (Call logs)

**Owner code:** `web/lib/calls/recordings.ts` (pure rules), `web/lib/services/vapi.ts` (read-only Vapi client),
`web/lib/calls/recording-capture.ts` (copy into our storage), `web/lib/calls/call-logs.ts` + `app/api/calls/**`,
page `/call-logs`, `components/calls/`. Design: `docs/superpowers/specs/2026-11-19-call-recordings-design.md`.

## What it's for

Train the voice agents: hear every AI call **our app** placed, read what was said, download both. Our calls go through
Voizo's shadow API test campaigns and are deliberately kept out of Voizo's dashboard and daily reports, so they're
reviewed here, never there. Voizo is not changed by this.

## Where

- **Outreach → Call logs:** every AI call, newest first. Filters: voice agent, result, dates, "Test numbers only".
  Click a call: player, transcript, **Download recording**, **Download transcript (.txt)**.
- **CRM side panel → Timeline:** each AI call has **Listen · transcript** (same viewer).

## How recordings arrive

1. When an AI call ends, the call worker (Cloud Run, `MODE=call`, every 15 min) saves the transcript (from Voizo) and
   asks Vapi for the recording with the call's Vapi id.
2. The recording is downloaded and stored in our private bucket `call-recordings` (Vapi deletes its copy after 14 days).
3. Not ready yet? Every call tick retries up to 10 such calls, for 13 days.

Each call also remembers the **voice agent** used and whether it dialled a **test number**.

## Setup

- `VAPI_API_KEY` = Voizo's **`VAPI_PRIVATE_KEY`** (the private key of the Vapi account Voizo dials through). Read-only
  use here. Server only: never under a `NEXT_PUBLIC_` name. Put it in the repo-root `.env` and on the **Cloud Run job**,
  then redeploy (`bash scripts/deploy-cloud-run-job.sh`). Vercel doesn't need it.

## Messages and what to do

| Message | Meaning / fix |
|---|---|
| Recording not ready yet (fetched within 15 min of the call) | Normal right after a call. Wait for the next tick. |
| Recordings are off (no Vapi key) | Set `VAPI_API_KEY` on Cloud Run and redeploy. |
| Recordings are off: the Vapi key can't read this call | The key is for another Vapi account. Use Voizo's `VAPI_PRIVATE_KEY`. |
| Vapi has no recording for this call | Recording was off for that call at Vapi (or it ended before connecting). |
| Recording expired at Vapi | Not fetched within 14 days (worker down / no key then). Gone. |
| No recording for this call | The call never connected to Vapi (failed dial, no answer). |
