# Brain jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Brain" page where the operator types a job ("get me 100 plumbers in Texas and work them"), answers a few settings as choices, approves one plan with tick-boxes, and the app then emails, sends contact forms and queues AI calls by itself.

**Architecture:** The AI decides at two fixed points only (understand the command; judge each lead). Everything else is code: pure rules in `web/lib/brain/` (what a lead may be offered, which channels it has, what is due, the budget), thin loaders/savers next to them, and the existing machinery for the sending (batch-email plans + sequence tick, contact-form runs, the Quick calls campaign + call worker). A new part of the automation tick moves running jobs forward.

**Tech Stack:** TypeScript, Next.js 14 route handlers, Supabase, OpenAI Responses API (strict json_schema, like `lib/services/openai-assistant.ts`), Cloud Run job modes, vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-brain-jobs-design.md`

## Global Constraints

- The AI never acts: it only picks among offers / channels the code lists. Anything else it returns → the rule-based default.
- Nothing is sent before Approve; a call only for a row whose ☎ is ticked.
- Never contact a suppressed lead (unsubscribed, do-not-call, not interested); re-read the lead before every form and call.
- Never solve a CAPTCHA; never a second form submit; never re-dial after a lost response (existing code keeps these: don't route around it).
- Never pitch a website to `has_website`; never call a review-site lead; never dial a GDPR country (even with "EU/UK in").
- Never spend past `settings.budgetUsd`: the next paid step that would cross it pauses the job.
- No lead in two active jobs; never re-email a lead already emailed.
- Defaults: 10 emails, 10 contact forms, 5 calls a day; follow-ups 0; EU/UK out. Count cap 300 (Apify).
- Order per lead: day 0 email + contact form; call due at first touch + 2 days; follow-ups day 4 / 8 / 12 (existing).
- Migration number **074**. Code tolerates 074 missing (the page says to run it). Model env `OPENAI_BRAIN_MODEL`, default `gpt-5.4-mini`.
- Project rules (CLAUDE.md): file header on every TS file, thin routes (zod → lib), `{ success, data | error }`, client components dumb, `import "@/lib/server-guard"` in server modules, workflow doc first, no paid calls in tests.
- Run from `web/`: tests `npx vitest run <file>`, all `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Commit after each task (`Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`). Never push.

## Rulings made while planning (deviations from the spec's wording)

- **Calls go through the standing "Quick calls (AI) · <CC>" campaign** (`queueQuickCall`), not a campaign per job: it already exists per country with the right hours. Pause = the job stops queueing; Cancel removes the job's still-pending members. Cost if wrong: a job's calls can't be paused separately from other quick calls once queued (they are queued only when due, so at most a day's worth).
- **`startBatchEmail` gets two options** (`only`, `name`) and returns `slots` instead of the brain duplicating it. Cost if wrong: one shared function serves two callers.

## Review Focus

1. **Approve pressed twice / in two tabs** → one email campaign, one schedule (Task 5: conditional `review → running` update, second call refused).
2. **A lead replies or unsubscribes between the plan and Approve, or between two steps** → not contacted (Task 5 re-checks at approve; Task 6 `stopReason` before each step).
3. **Two tick runs overlap** → no form or call twice for a lead (Task 6: conditional row claims).
4. **The search finds nothing to contact** → the job reaches `review` with a plain "nothing to contact" notice and can be cancelled (Task 4).
5. **Migration 074 not applied / OpenAI key missing** → the page says so; nothing crashes; the plan falls back to rules (Tasks 3, 4).

---

### Task 1: Workflow, migration 074, pure rules

**Files:**
- Create: `workflows/run_brain_job.md` (the SOP: what the operator does, the rules, going live; written first)
- Create: `db/migrations/074_brain_jobs.sql`; Modify: `db/schema.sql`, `.env.example` (`OPENAI_BRAIN_MODEL`), `web/lib/config.ts` (env `OPENAI_BRAIN_MODEL` default `gpt-5.4-mini`)
- Create: `web/lib/brain/rules.ts`, Test: `web/lib/brain/rules.test.ts`

**Migration 074:**
- `brain_jobs`: `id uuid pk default uuid_generate_v4()`, `command text not null`, `intent text not null check (intent in ('find_and_work','work_batch'))`, `status text not null default 'asking' check (status in ('asking','searching','planning','review','running','paused','done','cancelled','failed'))`, `ask jsonb not null default '{}'`, `settings jsonb not null default '{}'`, `batch_id uuid references batches(id) on delete set null`, `email_campaign_id uuid`, `spent_usd numeric(10,4) not null default 0`, `notice text`, `approved_at timestamptz`, `created_at`/`updated_at timestamptz not null default now()`; RLS disabled like the neighbours.
- `brain_job_leads`: `job_id uuid references brain_jobs(id) on delete cascade`, `lead_id uuid references leads(id) on delete cascade`, primary key `(job_id, lead_id)`, `decision text not null check (decision in ('contact','skip'))`, `offer text`, `channels text[] not null default '{}'`, `allowed_offers text[] not null default '{}'`, `allowed_channels text[] not null default '{}'`, `reason text`, `source text not null check (source in ('ai','rule','default'))`, `approved boolean not null default false`, `first_touch_at timestamptz`, `form_state text` (`pending|sent|needs_person|failed|skipped`), `call_due_at timestamptz`, `call_state text` (`pending|queued|skipped`), `outcome text` (`win|stopped|done`), `outcome_reason text`, `updated_at`. Index on `(lead_id)`.
- `alter table batches add column if not exists brain_job_id uuid;`
- `contact_form_runs_source_check` → `('manual','auto','brain')`.

**Interfaces — Produces (`web/lib/brain/rules.ts`, pure, no server imports):**
```ts
export type Channel = "email" | "form" | "call";
export type JobStatus = "asking" | "searching" | "planning" | "review" | "running" | "paused" | "done" | "cancelled" | "failed";
export interface JobSettings { budgetUsd: number; channels: Record<Channel, boolean>; perDay: { emails: number; forms: number; calls: number }; followUps: 0 | 1 | 2 | 3; includeEu: boolean }
export const DEFAULT_SETTINGS: JobSettings; // budget 20, all channels on, 10 / 10 / 5, followUps 0, includeEu false
export const MAX_COUNT = 300; export const JUDGE_USD_PER_LEAD = 0.01; export const FORM_USD = 0.1; export const CALL_DELAY_DAYS = 2;
export function cleanSettings(raw: unknown): JobSettings;            // clamps: budget 1–500, emails 1–30, forms 0–20, calls 0–20, followUps 0–3
export function allowedOffers(segment: string | null): ServiceKey[];
//  no_website → website_build, ai_receptionist, ai_booking · old_website → website_redesign, ai_receptionist, ai_booking, seo
//  has_website → ai_receptionist, ai_booking, seo · liquidation → buy_inventory · exhibitor → booth_build · reputation → reputation_mgmt · else []
export interface LeadFacts { id: string; segment: string | null; emailSkip: string | null; hasForm: boolean; callBlock: string | null; inOtherJob: boolean; callOffers: string[] /* offers Voizo has a script for */ }
export interface Moves { offers: ServiceKey[]; channels: Channel[]; skip: string | null /* plain reason when nothing can be done */ }
export function allowedMoves(f: LeadFacts, s: JobSettings): Moves;
//  email ⇐ channel on && emailSkip === null · form ⇐ on && hasForm · call ⇐ on && callBlock === null && some allowed offer ∈ callOffers
//  skip: inOtherJob → "Already in another brain job" · no offers → "No offer fits this lead" · no channels → "No way to reach this lead (<why>)"
export interface Decision { contact: boolean; offer: ServiceKey | null; channels: Channel[]; reason: string; source: "ai" | "rule" | "default" }
export function defaultDecision(m: Moves, f: LeadFacts): Decision;   // skip → {contact:false, source:"rule"}; else first allowed offer, all channels, source "default"
export function validateDecision(raw: unknown, m: Moves, f: LeadFacts): Decision;
//  raw {contact, offer, channels, reason}: offer ∉ m.offers, a channel ∉ m.channels, contact true with no channel, or bad shape → defaultDecision;
//  a call is dropped (not the whole decision) when the chosen offer ∉ f.callOffers; reason trimmed to 240 chars
export function jobEstimate(o: { searchUsd: number; leads: number; formLeads: number }): { searchUsd: number; judgeUsd: number; formsUsd: number; totalUsd: number };
export function canSpend(spent: number, next: number, budget: number): boolean; // spent + next <= budget + 0.0001
```

- [ ] **Step 1:** Write `workflows/run_brain_job.md` (operator steps, the rules above, going live incl. "automation-tick needs the operator's word").
- [ ] **Step 2:** Write `rules.test.ts`: `allowedOffers` for all six segments (has_website never contains a website offer); `allowedMoves`: each channel's condition, the three skip reasons, a channel switched off in settings is never allowed; `validateDecision`: a valid AI answer passes with source `"ai"`; offer outside the list → default; channel outside the list → default; `{contact:true, channels:[]}` → default; call dropped when the offer has no script; garbage (`null`, `"x"`, `{}`) → default; `cleanSettings` clamps (`budgetUsd: 99999` → 500, `calls: -1` → 0, `followUps: 9` → 3); `canSpend(19.95, 0.1, 20)` false, `canSpend(19.9, 0.1, 20)` true.
- [ ] **Step 3:** Run `npx vitest run lib/brain/rules.test.ts` → FAIL (module missing).
- [ ] **Step 4:** Implement `rules.ts`; add the migration, schema.sql, env.
- [ ] **Step 5:** Run the test → PASS; `npx tsc --noEmit` clean. Commit `feat(db): brain jobs tables and rules`.

### Task 2: The OpenAI caller and command understanding

**Files:**
- Create: `web/lib/services/openai-brain.ts` (the only OpenAI caller for the brain), `web/lib/brain/command.ts` (pure), Test: `web/lib/brain/command.test.ts`

**Interfaces — Produces:**
```ts
// lib/services/openai-brain.ts (server)
export function isBrainConfigured(): boolean; // OPENAI_API_KEY set
export async function brainJson<T>(o: { name: string; instructions: string; input: string; schema: object; maxOutputTokens?: number }): Promise<{ data: T; usd: number }>;
//  Responses API, strict json_schema, reasoning effort low, store false, 45 s timeout, retry maxAttempts 2 (shouldRetryOpenAi),
//  usd from usage × OPENAI_CONTACT_USD_PER_MTOK_IN/_OUT, recordOpenAiResult(..., "brain"); throws BrainError(code) like AssistantError
// lib/brain/command.ts (pure)
export interface Ask { intent: "find_and_work" | "work_batch" | "other"; niche: string | null; place: string | null; countryCode: string | null; count: number | null; batchHint: string | null; missing: string | null }
export const COMMAND_SCHEMA: object; export function commandInstructions(): string; export function parseAsk(raw: unknown): Ask; // count capped to MAX_COUNT, country lower-case 2 letters, unknown intent → "other"
export const WHAT_I_CAN_DO: string; // the fixed reply for "other"
export interface Question { key: "budget" | "channels" | "perDay" | "followUps" | "includeEu"; label: string; kind: "choice" | "ticks" | "numbers"; options?: { value: string; label: string }[]; value: unknown; note?: string }
export function buildQuestions(o: { ask: Ask; estimate: ReturnType<typeof jobEstimate>; callsAvailable: boolean; isEuPlace: boolean }): Question[];
//  budget options 10 / 20 / 50 (+ other), preselected = smallest ≥ estimate.totalUsd; includeEu only when isEuPlace; AI call tick greyed (note) when !callsAvailable
export function matchBatch(hint: string | null, batches: { id: string; niche: string | null; city: string | null; status: string }[]): { id: string } | { candidates: { id: string; label: string }[] };
//  only status "done"; one clear match (every hint word in niche+city, case-insensitive) → id; else up to 8 newest candidates
```

- [ ] **Step 1:** Write `command.test.ts`: `parseAsk` (count 10000 → 300; missing place stays in `missing`; junk → intent other); `buildQuestions` (estimate 12 → budget 20 preselected; includeEu absent for a US place, present for `countryCode: "de"`; call option noted when unavailable); `matchBatch` ("austin dentists" → the one done batch; a running batch is never matched; two matches → candidates).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement both files. **Step 4:** Run → PASS, tsc clean. **Step 5:** Commit `feat(web): brain command understanding`.

### Task 3: Jobs store, create and start

**Files:**
- Create: `web/lib/brain/jobs.ts`, `web/app/api/brain/jobs/route.ts`, `web/app/api/brain/jobs/[id]/route.ts`, `web/lib/brain/request.ts` (zod bodies); Test: `web/lib/brain/jobs.test.ts`

**Interfaces — Consumes:** Task 1 types, Task 2 `brainJson`, `parseAsk`, `buildQuestions`, `matchBatch`; `createBatch` / `estimate` (`lib/pipeline/orchestrator.ts`, `lib/pricing.ts`), `triggerBatchJob`, `triggerJob` (`lib/services/cloud-run.ts`), `templateForNiche`, `isVoizoConfigured`, `isNoCallCountry`.
**Produces:**
```ts
export const MISSING_074 = "The Brain needs database update 074 (run db/migrations/074_brain_jobs.sql in Supabase).";
export interface BrainJob { id: string; command: string; intent: "find_and_work" | "work_batch"; status: JobStatus; ask: Ask; settings: JobSettings; batch_id: string | null; email_campaign_id: string | null; spent_usd: number; notice: string | null; approved_at: string | null; created_at: string; updated_at: string }
export interface JobsDeps { /* db reads/writes, understand(command), createBatch, startBatch, startPlan, now */ }
export async function listJobs(): Promise<{ jobs: BrainJob[]; missing: boolean }>;
export async function getJob(id: string): Promise<BrainJob | null>;
export async function updateJob(id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]): Promise<boolean>; // conditional on status when given; false = not updated
export async function addSpend(id: string, usd: number): Promise<void>;
export async function createJob(command: string, deps?: JobsDeps): Promise<{ kind: "reply"; text: string } | { kind: "job"; job: BrainJob; questions: Question[]; estimate: ...; candidates?: { id: string; label: string }[] }>;
export async function startJob(id: string, input: { settings: unknown; batchId?: string; missing?: string }, deps?: JobsDeps): Promise<{ ok: true; job: BrainJob } | { ok: false; message: string }>;
//  find_and_work: refuses budget < searchUsd + judgeUsd (message with both numbers); createBatch({scraper:"apify", limit: ask.count, settings:{ai_lookup:true}, extra:{brain_job_id}}) → status "searching" → startBatch
//  work_batch: refuses a batch that has a running batch email or is waiting to auto-email; status "planning" → startPlan (Cloud Run MODE=brain STEP=plan JOB_ID)
```
Routes: `GET /api/brain/jobs` → `{jobs, missing}`; `POST {command}` (1–500 chars) → createJob; `GET /api/brain/jobs/:id` → `{job}` (Task 4 adds rows + progress); `PATCH {settings, batchId?, missing?}` → startJob (409 + message when refused, 503 for MISSING_074 / Cloud Run not configured).

- [ ] **Step 1:** Write `jobs.test.ts` with fake deps: "other" command → reply, no job row; a command with no place → job in `asking` with `ask.missing` set and no batch created; `startJob` with budget 1 on a 100-lead search → refused, message names the estimate; a good start → createBatch called once with `brain_job_id` and no `auto_email`, status `searching`; work_batch on a batch being emailed → refused; table missing → `MISSING_074`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS, tsc + lint clean. **Step 5:** Commit `feat(api): brain jobs: create, questions, start`.

### Task 4: Judging — building the plan

**Files:**
- Create: `web/lib/brain/judge.ts` (pure prompt + schema), `web/lib/brain/plan.ts` (server: load, judge, save); Modify: `web/lib/pipeline/orchestrator.ts` (after `armAutoEmail`: `await planJobForBatch(batchId)`, never throws), `web/scripts/cloud-run-job.ts` (`MODE=brain STEP=plan JOB_ID`), `web/app/api/brain/jobs/[id]/route.ts` (GET returns rows); Tests: `web/lib/brain/judge.test.ts`, `web/lib/brain/plan.test.ts`

**Interfaces — Consumes:** `allowedMoves`, `validateDecision`, `defaultDecision`, `brainJson`, `skipReason` + `SKIP_TEXT` (`lib/campaigns/batch-email.ts`), `leadHost` (`lib/contact-form/rules.ts`), `callBlock`, `listScripts` (offer keys Voizo has scripts for), `resolveSegment`.
**Produces:**
```ts
// judge.ts
export const JUDGE_SCHEMA: object; // { contact: boolean, offer: string, channels: string[], reason: string } strict
export function judgeInstructions(): string; // the rules in Global Constraints, "reason = one plain sentence for a non-technical reader", "when unsure, contact with every listed channel"
export function judgeInput(o: { lead: JudgeLead; moves: Moves }): string; // name, category, place, rating, reviews, website verdict + reasons + pitch, AI Lookup summary (≤600 chars), contacts on file, the allowed offers and channels by name
// plan.ts
export interface PlanRow { lead_id: string; business_name: string; verdict: string | null; decision: "contact" | "skip"; offer: string | null; channels: Channel[]; allowed_offers: string[]; allowed_channels: Channel[]; reason: string; source: "ai" | "rule" | "default"; approved: boolean }
export async function buildPlan(jobId: string, deps?: PlanDeps): Promise<{ rows: number; contact: number; usd: number }>;
//  only from status searching | planning (conditional update → "planning"); judges with a pool of 5; a lead whose AI call throws → defaultDecision;
//  OpenAI not configured or the first 3 calls all fail → rules for everyone + notice "AI wasn't available, so this plan uses the standard rules.";
//  stops judging (defaults for the rest + notice) when canSpend says the budget is reached; saves rows (approved = decision "contact"), addSpend, status "review";
//  zero rows to contact → notice "Nothing to contact in this batch: <top skip reasons>."
export async function planJobForBatch(batchId: string): Promise<void>; // the job with that batch in "searching"; none → nothing; never throws
export async function loadPlan(jobId: string): Promise<PlanRow[]>;
```

- [ ] **Step 1:** Write `judge.test.ts` (the input lists only the allowed offers/channels and never includes the lead's email address or phone number; a lead with no website check still produces an input) and `plan.test.ts` with fake deps: AI answer inside the lists is saved with source `ai`; outside → `default`; code-skipped leads make no AI call; OpenAI down → all rows `default`/`rule` + notice, status `review`; budget reached mid-way → remaining rows default + notice; nothing to contact → `review` + the notice (Review Focus 4); a second `buildPlan` on a job already in `review` does nothing.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; wire the orchestrator hook and the job mode. **Step 4:** PASS, tsc + lint. **Step 5:** Commit `feat(pipeline): the brain judges each lead into a plan`.

### Task 5: Approve — start the emails and the schedule

**Files:**
- Modify: `web/lib/campaigns/batch-email-plan.ts` (`startBatchEmail` options `only?: Record<string, ServiceKey>` = only these leads, each with this offer; `name?: string`; result gains `slots: Record<string, string>` = lead id → first send time; with `only`, a batch already being emailed is still refused), its test file
- Create: `web/lib/brain/schedule.ts` (pure), `web/lib/brain/approve.ts`, `web/app/api/brain/jobs/[id]/approve/route.ts`; Tests: `web/lib/brain/schedule.test.ts`, `web/lib/brain/approve.test.ts`

**Interfaces — Produces:**
```ts
// schedule.ts (pure)
export function scheduleTouches(o: { rows: { lead_id: string; channels: Channel[] }[]; emailSlots: Record<string, string>; window: SendWindow; formsPerDay: number; now: Date }): Record<string, { first_touch_at: string; call_due_at: string | null }>;
//  email in emailSlots → that slot; else (form / call only) staggered with staggerSends at gap = window minutes / formsPerDay (min 3), so no day gets more than formsPerDay;
//  call_due_at = first_touch_at + CALL_DELAY_DAYS days when the row has "call", else null
// approve.ts
export async function approvePlan(jobId: string, picks: { leadId: string; approved: boolean; channels: Channel[]; offer: string | null }[], deps?: ApproveDeps): Promise<{ ok: true; emails: number; forms: number; calls: number; days: number } | { ok: false; message: string }>;
//  1. conditional status review → running (false → "This plan was already approved or cancelled.")   [Review Focus 1]
//  2. each pick is checked against the row's allowed_offers / allowed_channels (anything else is dropped, never widened)
//  3. the lead is re-read: allowedMoves again with today's facts; a lead that replied / unsubscribed / was emailed meanwhile is unticked with outcome "stopped" [Review Focus 2]
//  4. startBatchEmail(batchId, { only: {lead → offer} for rows with "email", dailyLimit: perDay.emails, followUps, includeEu, choices: {}, name: `Brain · <command, 60 chars>` }) when there are any
//  5. scheduleTouches → rows get first_touch_at, call_due_at, form_state "pending" (when "form"), call_state "pending" (when "call"); job gets email_campaign_id, approved_at
//  any failure after step 1 → status back to "review" with the reason as notice (nothing half-started is left running: an email campaign already made is set to "done")
```
Route: `POST /api/brain/jobs/:id/approve {rows: [{leadId, approved, channels, offer}]}` (≤ 300 rows) → 200 summary, 409 + message.

- [ ] **Step 1:** Extend the batch-email-plan tests: `only` restricts to those leads and uses the given offer; `slots` has one entry per enrolled lead. Write `schedule.test.ts` (100 form-only rows at 10 a day never put more than 10 on one day; an email row's first touch equals its slot; call due exactly 2 days later; no call → null) and `approve.test.ts` (second approve refused; a pick naming a channel outside `allowed_channels` is dropped; a lead that unsubscribed since the plan is not enrolled; a failing `startBatchEmail` puts the job back to `review`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS, all tests, tsc + lint. **Step 5:** Commit `feat(web): approve a brain plan: emails start, forms and calls are scheduled`.

### Task 6: The automatic run (automation tick part)

**Files:**
- Create: `web/lib/brain/due.ts` (pure), `web/lib/brain/runner.ts`; Modify: `web/lib/automation/tick.ts` (`part("brainJobs", () => runBrainJobs(now))` before the contact forms; skipped like them after a scheduled batch), `web/lib/calls/quick-call.ts` (`queueQuickCall` option `voizoCampaignId?: string | null` used when no `agentId`), `web/lib/contact-form/runs.ts` (`startLook` source accepts `"brain"`), `web/lib/contact-form/rules.ts` (`FormRun.source` adds `"brain"`); Tests: `web/lib/brain/due.test.ts`, `web/lib/brain/runner.test.ts`

**Interfaces — Produces:**
```ts
// due.ts (pure)
export interface JobLeadRow { job_id: string; lead_id: string; decision: "contact" | "skip"; offer: string | null; channels: Channel[]; approved: boolean; first_touch_at: string | null; form_state: string | null; call_due_at: string | null; call_state: string | null; outcome: string | null }
export interface LeadNow { stage: string | null; lifecycle_stage: string | null; call_status: string | null; seq_status: string | null; replied: boolean }
export function stopReason(l: LeadNow): { kind: "win" | "stopped"; reason: string } | null;
//  win: stage replied / meeting_* / closed_won, or call_status "qualified", or replied · stopped: lifecycle unsubscribed | dnc, call_status not_interested | dnc, stage dead | closed_lost
//  (a wrong number is NOT a stop: only the call is skipped, when queueQuickCall refuses it)
export function formDue(row: JobLeadRow, now: number): boolean;  // approved, channels has "form", form_state "pending", first_touch_at <= now, no outcome
export function callDue(row: JobLeadRow, now: number): boolean;  // approved, has "call", call_state "pending", call_due_at <= now, no outcome
export function rowFinished(row: JobLeadRow, lead: { seq_status: string | null }): boolean; // no pending form / call and its emails are not active
// runner.ts
export const FORMS_PER_TICK = 2;
export async function runBrainJobs(now?: number, deps?: RunnerDeps): Promise<{ jobs: number; forms: number; calls: number; wins: number; done: number; notes: string[] }>;
//  kill switch on → forms skipped (calls still follow the job's own state); per running job:
//  a) re-read every open row's lead → stopReason → set outcome; on "stopped" also stopSequence(lead) and remove its pending Quick-calls member; on "win" stop its other pending steps
//  b) forms: inside the campaign window (Mon–Fri 9–17 batch time), under perDay.forms (count this job's 'brain' runs in 24 h), ≤ FORMS_PER_TICK per tick over all jobs,
//     canSpend(spent, FORM_USD, budget) else job → paused + notice "Budget reached ($x of $y)."; claim the row (form_state pending → sending-in-progress marker via conditional update) [Review Focus 3];
//     startLook(force, source "brain") → runLookStep → ready ? startSend(offer's email via emailFor + picker, mailbox from poolFor) → runSendStep : needs_person;
//     result → form_state sent | needs_person | failed, addSpend(run cost)
//  c) calls: ≤ perDay.calls queued in 24 h for this job; claim the row (call_state pending → queued, conditional); queueQuickCall(lead, { voizoCampaignId: script for the row's offer }); refused → call_state "skipped" + reason
//  d) every row finished or with an outcome → job "done"
```

- [ ] **Step 1:** Write `due.test.ts` (each stop / win case; `formDue` false before first touch, false once not pending; `callDue` only at +2 days) and `runner.test.ts` with fake deps: a lead that replied is marked `win` and its form is not sent; an unsubscribed lead gets `stopped`, `stopSequence` and its queued call removed; forms respect `perDay.forms` and 2 per tick; a claim that returns false (another run took it) sends nothing; budget reached → job paused with the notice, no send; a blocked form → `needs_person`; a call is queued with the offer's Voizo campaign, never for a row without ☎; all rows finished → job `done`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; wire the tick. **Step 4:** PASS, all tests, tsc + lint. **Step 5:** Commit `feat(pipeline): brain jobs send contact forms and queue calls by themselves`.

### Task 7: Pause, resume, cancel, raise the budget

**Files:**
- Create: `web/lib/campaigns/campaign-status.ts` (`setCampaignStatus(id, status: "active" | "paused" | "done")`: the logic now inline in `app/api/campaigns/[id]/route.ts`, moved unchanged; the route calls it), `web/lib/brain/control.ts`, `web/app/api/brain/jobs/[id]/control/route.ts`; Tests: `web/lib/brain/control.test.ts`

**Produces:**
```ts
export async function controlJob(jobId: string, action: { kind: "pause" } | { kind: "resume" } | { kind: "cancel" } | { kind: "raise_budget"; budgetUsd: number }, deps?: ControlDeps): Promise<{ ok: true; job: BrainJob } | { ok: false; message: string }>;
//  pause: running → paused, setCampaignStatus(email campaign, "paused") · resume: paused → running (refused while spent >= budget: "Raise the budget first"), campaign "active"
//  cancel: asking | review | running | paused → cancelled; campaign "done" (stops remaining emails); open rows outcome "stopped" ("Job cancelled"); the job's pending Quick-calls members removed
//  raise_budget: budget must be > spent and ≤ 500; clears a "Budget reached" notice
```
- [ ] **Step 1:** Write `control.test.ts` (each transition; resume refused at budget; cancel in `review` touches no campaign; a finished job can't be cancelled). **Step 2:** FAIL. **Step 3:** Implement + route. **Step 4:** PASS, all tests, tsc + lint. **Step 5:** Commit `feat(web): pause, resume and cancel a brain job`.

### Task 8: The Brain page

**Files:**
- Create: `web/app/(dashboard)/brain/page.tsx` (server: `listJobs`, shows MISSING_074), `web/components/brain/BrainClient.tsx` (command box + jobs list), `web/components/brain/JobView.tsx` (one job: questions / searching / plan / running), `web/components/brain/PlanTable.tsx`, `web/lib/brain/view.ts` (pure: status text, progress counts, plan totals) + `web/lib/brain/view.test.ts`; Modify: `web/lib/nav.ts` (Brain entry, top of Outreach), `web/app/api/brain/jobs/[id]/route.ts` (GET adds `progress`)

**Behaviour (dumb components; all rules come from the API):**
- Command box → `POST /api/brain/jobs`; a `reply` is shown as text; a `job` opens its view.
- `asking`: the questions as radio choices / tick-boxes / number inputs with the preselected values, the estimate line, **Start**. A `missing` question shows one text input; `candidates` show a batch picker.
- `searching` / `planning`: a progress line, polled every 5 s (stops after 30 min).
- `review`: the notice, totals ("82 to contact · 60 emails · 30 forms · 25 calls · about 6 working days · $3.10 spent of $20"), the table (tick, business → lead link, website verdict, offer select limited to `allowed_offers`, a tick per allowed channel, reason, source mark for `default`), skipped rows greyed (tickable only when `allowed_channels` is non-empty), "View the emails" (the offer's sample from `/api/batches/:id/email` preview), **Approve ticked (N)** and **Cancel job**.
- `running` / `paused` / `done`: counts (emailed, forms sent, calls queued, wins), spent of budget, "Needs a person" list (rows with `form_state needs_person` → lead links), Pause / Resume / Cancel / Raise budget.
- `view.ts`: `statusText(job)`, `planTotals(rows, picks)`, `progressOf(rows)`.

- [ ] **Step 1:** Write `view.test.ts` (totals count only ticked rows and ticked channels; `progressOf` counts wins / needs-person; status text for each status incl. paused-by-budget). **Step 2:** FAIL. **Step 3:** Implement page + components. **Step 4:** PASS, tsc + lint, `npm run build` clean. **Step 5:** Commit `feat(web): the Brain page`.

### Task 9: Docs, the assistant guide, QA checklist, final check

**Files:** Modify `web/lib/assistant/knowledge.ts` (a "Brain" section: the two commands, the questions, the plan, what runs by itself, Pause/Cancel, budget), `CLAUDE.md` (How the App Works + API routes + env + schema note 074 + job mode `brain`), `workflows/run_automation.md` (the new tick part); Create `docs/status/Brain Jobs QA Checklist.csv` (a whole job on an existing small batch whose leads are the operator's own email / phone / the RateUp test form: commands, questions, refusals, plan edits, approve, the form, the call tick, pause, cancel, budget).

- [ ] **Step 1:** Write the docs and the checklist. **Step 2:** Run `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build` → all clean. **Step 3:** Commit `docs(docs): brain jobs guide, workflow and QA checklist`.
