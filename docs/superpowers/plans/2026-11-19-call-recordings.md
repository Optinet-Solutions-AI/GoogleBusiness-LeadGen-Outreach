# AI Call Recordings + Transcripts (Call logs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI call our app places gets its recording (copied from Vapi into our private storage) and transcript, playable and downloadable on a new Call logs page and on the lead's CRM history.

**Architecture:** The Cloud Run call worker (`runCallTick`) saves agent/test flags at dial time, then after a call ends asks Vapi (`GET /call/{vapiCallId}`, private key) for a recording link, downloads it and stores it in a private Supabase bucket; a sweep at the start of every tick retries ones not ready yet. Vercel routes hand out 1-hour signed links; pure helpers decide states, labels, file names and the transcript `.txt`. Voizo is not touched.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (Postgres + Storage), zod, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-19-call-recordings-design.md`

## Global Constraints

- Voizo is not touched: no request to Voizo beyond the existing Dial API calls; nothing new is written to Voizo.
- Vapi key env name `VAPI_API_KEY` (server-only, never `NEXT_PUBLIC_`); empty = recordings off, transcripts still work.
- Vapi calls only in `lib/services/vapi.ts`, with `lib/retry.ts` on GETs and `lib/logger.ts` logging; never throw out of capture.
- Bucket `call-recordings`, **private** (`public: false`), object path `<call_attempt id>.<ext>`; signed links 3600 s.
- Retry window 13 days after the call; older and never fetched → `meta.recording_state = 'lost'`. Sweep ≤ 10 calls per tick.
- `meta.recording_state` values: `copied` · `none_at_vapi` · `no_access` · `lost` (absent = pending).
- Dial-time meta added on `call_attempts`: `test_number: boolean`, `voizo_campaign_id: string|null`, `agent_name: string|null`.
- No migration (uses existing `call_attempts.recording_url`, `transcript`, `meta`).
- Every TS file has the 4-line header (CLAUDE.md); routes return `{ success, data | error }`; clients never import `lib/db` or `lib/services/*`.
- Run tests from a capital-`C:` path (PowerShell `Set-Location C:\Users\Chris-Optinet\GBLG\web`): a lowercase `c:` cwd breaks vitest.

## Review Focus

1. A recording not ready right after the call → stays pending and is retried, never marked `none_at_vapi` in the first 2 hours (Task 1 test `nextRecordingStep`).
2. A key from the wrong Vapi account (401/403/404 on our call ids) → `no_access`, a clear page message, one log line per tick, dialing unaffected (Task 1 `recordingMessage`, Task 3 `sweepRecordings` never throws).
3. A call older than 13 days never fetched → `lost`, "Recording expired at Vapi" (Task 1 test).
4. Business names with `/`, accents, emoji or empty → a safe download file name (Task 1 test `downloadName`).
5. Empty or missing transcript → the `.txt` still has the header and "(no transcript)" (Task 1 test `transcriptTxt`).

---

### Task 1: Pure helpers + workflow doc

**Files:**
- Create: `workflows/review_call_recordings.md` (written first: what Call logs shows, how capture works, the key, states and messages, failure fixes)
- Create: `web/lib/calls/recordings.ts` (pure, client-safe; imports only `@/lib/phone`)
- Test: `web/lib/calls/recordings.test.ts`

**Interfaces:**
- Produces:
  - `type RecordingState = "copied" | "none_at_vapi" | "no_access" | "lost"`
  - `RECORDING_RETRY_DAYS = 13`, `NOT_READY_GRACE_MS = 2 * 3600_000`
  - `pickRecordingUrl(vapiCall: unknown): string | null` — first https string of `artifact.presignedMonoUrl`, `artifact.presignedStereoUrl`, `artifact.recording.mono.combinedUrl`, `artifact.recordingUrl`, `recordingUrl`.
  - `recordingExt(url: string, contentType: string | null): "mp3" | "wav" | "ogg" | "webm"` — content-type first (`audio/mpeg`→mp3, `audio/wav`/`audio/x-wav`/`audio/wave`→wav, `audio/ogg`→ogg, `audio/webm`→webm), else the URL path's extension if one of those, else `"wav"`.
  - `nextRecordingStep(o: { linkFound: boolean; endedAt: string; now: number }): "download" | "wait" | "none_at_vapi" | "lost"` — older than 13 days → lost; link → download; no link and < 2 h since end → wait; else none_at_vapi.
  - `recordingMessage(o: { recordingUrl: string | null; state: string | null; hasVapiId: boolean; endedAt: string | null; now: number; keySet: boolean }): { kind: "ready" | "pending" | "none" ; text: string }` — exact texts: ready → `""`; no Vapi id → `"No recording for this call"`; `!keySet` → `"Recordings are off (no Vapi key)"`; `no_access` → `"Recordings are off: the Vapi key can't read this call"`; `none_at_vapi` → `"Vapi has no recording for this call"`; `lost` or pending older than 13 days → `"Recording expired at Vapi"`; else pending → `"Recording not ready yet (fetched within 15 min of the call)"`.
  - `agentLabel(meta: Record<string, unknown> | null): string` — no `agent_name` key → `"—"`; `agent_name` string → it; null with `voizo_campaign_id` string → that id; both null → `"Voizo default"`.
  - `isTestCall(meta: Record<string, unknown> | null, leadPhone: string | null, countryCode: string | null): boolean` — `meta.test_number` boolean wins; else `toE164(meta.phone)` ≠ `toE164(leadPhone, countryCode)` when both exist; else false.
  - `downloadName(business: string, isoDate: string, ext: string): string` — lowercase ASCII slug of the name (accents stripped, non-alphanumerics → `-`, trimmed, max 60, empty → `call`) + `-` + `yyyy-mm-dd` + `.` + ext.
  - `transcriptTxt(c: { business: string; date: string; phone: string | null; agent: string; result: string; durationSec: number | null; transcript: string | null }): string`
  - `RESULT_FILTERS: Record<"interested" | "not_interested" | "callback" | "no_answer" | "failed", { outcome?: string; status?: string[] }>` = interested `{outcome:"interested"}`, not_interested `{outcome:"not_interested"}`, callback `{outcome:"callback"}`, no_answer `{status:["no_answer","voicemail","busy"]}`, failed `{status:["failed","canceled","unknown"]}`.
  - `resultLabel(row: { status: string; outcome: string | null }): string` — outcome (underscores → spaces) else status (same).

- [ ] **Step 1: Write the workflow doc** `workflows/review_call_recordings.md` from the spec (sections: What it's for · Where (Outreach → Call logs, CRM call row) · How recordings arrive · Setup (`VAPI_API_KEY` = Voizo's `VAPI_PRIVATE_KEY`, Cloud Run, redeploy) · Messages and what to do · Not mixed with Voizo).
- [ ] **Step 2: Write failing tests** in `recordings.test.ts`:

```ts
const now = Date.parse("2026-11-19T12:00:00Z");
it("picks the presigned link first, ignores non-https", () => {
  expect(pickRecordingUrl({ artifact: { recordingUrl: "https://b/x.wav", presignedMonoUrl: "https://a/x.mp3" } })).toBe("https://a/x.mp3");
  expect(pickRecordingUrl({ artifact: { recording: { mono: { combinedUrl: "https://c/y.wav" } } } })).toBe("https://c/y.wav");
  expect(pickRecordingUrl({ artifact: { recordingUrl: "http://insecure/x.wav" } })).toBeNull();
  expect(pickRecordingUrl(null)).toBeNull();
});
it("extension from content type, then url, else wav", () => {
  expect(recordingExt("https://a/x", "audio/mpeg")).toBe("mp3");
  expect(recordingExt("https://a/x.ogg?sig=1", null)).toBe("ogg");
  expect(recordingExt("https://a/x", "application/octet-stream")).toBe("wav");
});
it("waits for a fresh call, gives up after 13 days", () => {
  expect(nextRecordingStep({ linkFound: false, endedAt: "2026-11-19T11:00:00Z", now })).toBe("wait");
  expect(nextRecordingStep({ linkFound: false, endedAt: "2026-11-19T09:00:00Z", now })).toBe("none_at_vapi");
  expect(nextRecordingStep({ linkFound: true, endedAt: "2026-11-19T11:59:00Z", now })).toBe("download");
  expect(nextRecordingStep({ linkFound: true, endedAt: "2026-11-05T11:00:00Z", now })).toBe("lost");
});
it("plain messages", () => {
  const base = { recordingUrl: null, state: null, hasVapiId: true, endedAt: "2026-11-19T11:50:00Z", now, keySet: true };
  expect(recordingMessage({ ...base, recordingUrl: "abc.mp3" }).kind).toBe("ready");
  expect(recordingMessage(base).text).toBe("Recording not ready yet (fetched within 15 min of the call)");
  expect(recordingMessage({ ...base, keySet: false }).text).toBe("Recordings are off (no Vapi key)");
  expect(recordingMessage({ ...base, state: "no_access" }).text).toBe("Recordings are off: the Vapi key can't read this call");
  expect(recordingMessage({ ...base, endedAt: "2026-11-01T00:00:00Z" }).text).toBe("Recording expired at Vapi");
  expect(recordingMessage({ ...base, hasVapiId: false }).text).toBe("No recording for this call");
});
it("agent label", () => {
  expect(agentLabel({})).toBe("—");
  expect(agentLabel({ agent_name: "Reputation", voizo_campaign_id: "c1" })).toBe("Reputation");
  expect(agentLabel({ agent_name: null, voizo_campaign_id: "c1" })).toBe("c1");
  expect(agentLabel({ agent_name: null, voizo_campaign_id: null })).toBe("Voizo default");
});
it("test call: flag wins, else number differs from the lead's", () => {
  expect(isTestCall({ test_number: false, phone: "+639171234567" }, "(512) 555-0100", "us")).toBe(false);
  expect(isTestCall({ phone: "+639171234567" }, "(512) 555-0100", "us")).toBe(true);
  expect(isTestCall({ phone: "+15125550100" }, "(512) 555-0100", "us")).toBe(false);
});
it("safe download names", () => {
  expect(downloadName("Café Zoë / Bar 🍷", "2026-11-19T10:00:00Z", "mp3")).toBe("cafe-zoe-bar-2026-11-19.mp3");
  expect(downloadName("", "2026-11-19T10:00:00Z", "wav")).toBe("call-2026-11-19.wav");
});
it("transcript txt has a header and says when empty", () => {
  const t = transcriptTxt({ business: "Acme", date: "2026-11-19T10:00:00Z", phone: "+15125550100", agent: "Voizo default", result: "interested", durationSec: 95, transcript: null });
  expect(t).toContain("Acme");
  expect(t).toContain("+15125550100");
  expect(t).toContain("Voizo default");
  expect(t).toContain("1 min 35 s");
  expect(t).toContain("(no transcript)");
});
```

- [ ] **Step 3: Run** `npx vitest run lib/calls/recordings.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `web/lib/calls/recordings.ts` with the signatures above.
- [ ] **Step 5: Run** the same — Expected: PASS.
- [ ] **Step 6: Commit** `feat(web): call recording helpers and review workflow`

### Task 2: Vapi service + config

**Files:**
- Create: `web/lib/services/vapi.ts`
- Test: `web/lib/services/vapi.test.ts`
- Modify: `web/lib/config.ts` (add `VAPI_API_KEY: z.string().default("")` next to `VOIZO_API_KEY`), `.env.example` (add `VAPI_API_KEY=` with a comment: Voizo's `VAPI_PRIVATE_KEY`, read-only use, server only, Cloud Run)

**Interfaces:**
- Produces:
  - `isVapiConfigured(): boolean`
  - `getVapiCall(vapiCallId: string): Promise<{ ok: true; data: unknown } | { ok: false; code: "not_configured" | "no_access" | "network_error" | "http_error"; status: number }>` — GET `https://api.vapi.ai/call/{encodeURIComponent(id)}`, Bearer key, 20 s timeout, retry 5xx (3 attempts) via `retry`; 401/403/404 → `no_access`.
  - `downloadAudio(url: string): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string | null } | { ok: false; error: string }>` — https only, `redirect: "error"`, 60 s timeout, refuses > 50 MB.

- [ ] **Step 1: Failing tests** (mock `@/lib/server-guard`, `../logger`, `../config` with `env.VAPI_API_KEY`, stub `global.fetch`): not_configured when key empty (fetch not called); 404 → `{ ok:false, code:"no_access" }`; 200 → data passed through; `downloadAudio("http://x")` → `ok:false` without fetching.
- [ ] **Step 2: Run** `npx vitest run lib/services/vapi.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `vapi.ts` (header, `import "@/lib/server-guard"`).
- [ ] **Step 4: Run** — Expected: PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat(web): vapi client for reading call recordings`

### Task 3: Capture + sweep in the call worker

**Files:**
- Create: `web/lib/calls/recording-capture.ts`
- Test: `web/lib/calls/recording-capture.test.ts`
- Modify: `web/lib/pipeline/call-scheduler.ts` (`Claimed` gains `isTest: boolean`; `claimNext` sets it from `testPhone`; `dialOne` adds `test_number`, `voizo_campaign_id`, `agent_name` to the inserted `meta`; `watch` calls `captureRecording` after a successful finalize; `runCallTick` calls `sweepRecordings()` first, before the `configured` check; `CallTickSummary` gains `recordings: number`)

**Interfaces:**
- Consumes: Task 1 `pickRecordingUrl`, `recordingExt`, `nextRecordingStep`, `RECORDING_RETRY_DAYS`; Task 2 `getVapiCall`, `downloadAudio`, `isVapiConfigured`.
- Produces:
  - `RECORDINGS_BUCKET = "call-recordings"`
  - `captureRecording(a: { id: string; meta: Record<string, unknown> | null; ended_at: string | null; created_at: string }): Promise<"copied" | "wait" | "none_at_vapi" | "no_access" | "lost" | "off" | "error">` — never throws; writes `recording_url` = object path and `meta.recording_state` per Global Constraints, merging into existing `meta`.
  - `sweepRecordings(limit = 10): Promise<number>` (count copied) — `provider='voizo'`, `done=true`, `recording_url is null`, `meta->>vapi_call_id` not null, `meta->>recording_state` null or `no_access`, newest first; one `no_access` log per sweep; never throws.
  - `agentNameFor(voizoCampaignId: string | null): Promise<string | null>` — `voice_agents.name` by `voizo_campaign_id`, null when none/missing table.

- [ ] **Step 1: Failing tests** with `vi.mock` of `@/lib/db` (a fake recording `update`/`upload` calls), `@/lib/services/vapi`, logger: link found → uploads `"<id>.mp3"` to `call-recordings` with `upsert: true` and updates `recording_url` + `meta.recording_state:"copied"` keeping existing meta keys; `no_access` → writes state, no upload; no link 30 min after end → `"wait"`, no write; key not set → `"off"`, nothing called; vapi throws → `"error"`, no throw.
- [ ] **Step 2: Run** `npx vitest run lib/calls/recording-capture.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `recording-capture.ts` (bucket created once per process with `createBucket(RECORDINGS_BUCKET, { public: false })`, errors ignored) and the scheduler changes.
- [ ] **Step 4: Run** the test + `npx vitest run lib/pipeline` + typecheck — Expected: PASS, existing call-scheduler tests still green.
- [ ] **Step 5: Commit** `feat(pipeline): save ai call recordings from vapi into our storage`

### Task 4: Call logs API

**Files:**
- Create: `web/lib/calls/call-logs.ts` (server: `listCallLogs`, `getCallLog`, `recordingLink`)
- Create: `web/app/api/calls/route.ts` (GET list), `web/app/api/calls/[id]/route.ts` (GET one), `web/app/api/calls/[id]/recording/route.ts` (GET signed link)
- Test: `web/lib/calls/call-logs.test.ts` (pure `parseCallLogFilters`)

**Interfaces:**
- Consumes: Task 1 helpers, Task 3 `RECORDINGS_BUCKET`.
- Produces:
  - `CallLogFiltersSchema` (zod): `agent?: string` (a `voizo_campaign_id`, or `"default"` = null id), `result?: keyof RESULT_FILTERS`, `from?: yyyy-mm-dd`, `to?: yyyy-mm-dd`, `test?: "1"`, `page?: int ≥ 1` (50 per page).
  - `parseCallLogFilters(q: URLSearchParams): CallLogFilters` (pure, invalid values dropped).
  - `CallLogRow = { id; leadId; business; createdAt; endedAt; phone: string | null; isTest: boolean; agent: string; result: string; durationSec: number | null; hasTranscript: boolean; recording: { kind: "ready" | "pending" | "none"; text: string } }`
  - `listCallLogs(f: CallLogFilters): Promise<{ rows: CallLogRow[]; total: number; agents: { id: string; name: string }[] }>`
  - `getCallLog(id: string): Promise<(CallLogRow & { transcript: string | null }) | null>`
  - `recordingLink(id: string, download: boolean): Promise<{ url: string } | null>` — signed 3600 s; `download` → `{ download: downloadName(...) }` option.
  - Routes: `GET /api/calls?…` → `{ rows, total, agents }`; `GET /api/calls/:id` → one row + transcript (404 when none); `GET /api/calls/:id/recording?download=1` → `{ url }` or 404 `"No recording for this call yet."`.

- [ ] **Step 1: Failing test** for `parseCallLogFilters`: `?result=interested&test=1&page=2&from=2026-11-01` parses; `?result=bogus&page=-3&from=nope` → those dropped, page 1.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** lib + thin routes (zod on `id` uuid).
- [ ] **Step 4: Run** test + typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): call logs list, one call and recording link`

### Task 5: Call logs page, viewer, CRM row, docs

**Files:**
- Create: `web/components/calls/CallViewer.tsx` (modal: business, date, number + "test" tag, agent, result, length; `<audio controls>` fed by `/api/calls/:id/recording`, or the state text; **Download recording** (opens the `?download=1` link) and **Download transcript (.txt)** (client Blob of `transcriptTxt`); transcript in a scrollable pre-wrap box)
- Create: `web/components/calls/CallLogsClient.tsx` (filters: agent, result, from/to, "Test numbers only"; table: When, Business (links to lead), Number, Agent, Result, Length, Recording dot; row click → `CallViewer`; Prev/Next pages)
- Create: `web/app/(dashboard)/call-logs/page.tsx` (`PageHeader` eyebrow "Outreach", title "Call logs", subtitle "Every AI call we placed: listen, read the transcript, download. Kept here only, never in Voizo's reports.")
- Modify: `web/lib/nav.ts` (Outreach → `{ href: "/call-logs", label: "Call logs", icon: AudioLines }` after Voice agents)
- Modify: `web/lib/crm/timeline-merge.ts` (`TimelineItem` gains `callId?: string`; call items set it) + its test (call item carries `callId`)
- Modify: `web/components/crm/CrmLeadPanel.tsx` (call items: "Listen · transcript" button opens `CallViewer`)
- Modify: `web/app/(dashboard)/voice-agents/page.tsx` subtitle → "…then add them here with the Voizo campaign id that runs each script."
- Modify docs: `CLAUDE.md` (env table row `VAPI_API_KEY`; API routes rows; How-it-works line), `web/lib/assistant/knowledge.ts` (Call logs), `docs/status/2026-W47.md` (dated block, two sections)

- [ ] **Step 1: Failing test** in `timeline-merge.test.ts`: a call row `{id:"a1",…}` → the merged item has `callId: "a1"`.
- [ ] **Step 2: Run** `npx vitest run lib/crm` — Expected: FAIL.
- [ ] **Step 3: Implement** the timeline change, components, page, nav, docs.
- [ ] **Step 4: Run** full `npx vitest run`, `npm run typecheck`, `npm run build` — Expected: all green, build OK.
- [ ] **Step 5: Commit** `feat(web): call logs page and call viewer with recordings and transcripts`
