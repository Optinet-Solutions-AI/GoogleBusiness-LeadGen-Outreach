# Contact Form Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Contact form" button on the lead page that shows a screenshot of the lead's website contact form, lets the operator compose the message from the Send email offers / saved templates, and on Send has AI fill and really submit the form, then shows before/after screenshots.

**Architecture:** Two short Cloud Run job runs per attempt (`MODE=contact-form`, `STEP=look|send`, `LEAD_ID`, `RUN_ID`), state in a new `contact_form_runs` table, the window polls `GET /api/leads/:id/contact-form`. Pure rules in `lib/contact-form/rules.ts`, browser + OpenAI computer-use in `lib/services/contact-form-browser.ts` (lifted from `web/scripts/contact-form-dryrun.ts`), orchestration in `lib/contact-form/runs.ts`.

**Tech Stack:** Next.js 14 route handlers, Supabase, Playwright (already a dependency), OpenAI Responses API computer-use, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-contact-form-send-design.md`

## Global Constraints

- All commands run from `web/` (PowerShell: `npx.cmd`, `npm.cmd`). Tests: `npx.cmd vitest run <path>`. Typecheck: `npm.cmd run typecheck`.
- Every new TS file starts with the CLAUDE.md header (purpose / Inputs / Outputs / Used by).
- Routes are thin: zod → `lib/` → `ok(...)` / `fail(...)` from `@/lib/response` (`{ success, data | error }`), wrapped in `withApi`.
- `lib/` server files `import "@/lib/server-guard";`. Client components never import `lib/db` or `lib/services/*`.
- Never bypass a CAPTCHA / bot check; never invent data (phone and unknown fields stay empty); never submit more than once per Send; no country (GDPR) block.
- Refuse when `EMAIL_SENDING_PAUSED_UNTIL` is in the future, or `isSuppressed(lead, "email")`. No email-verification gate.
- Only submit on the lead's own site: the contact page host must equal the host of `website_url` (or of `contact_page_url` when there's no website), `www.` ignored.
- Env (new, optional): `OPENAI_FORM_MODEL` (default `gpt-6.1-sol`), `OPENAI_FORM_USD_PER_MTOK_IN`, `OPENAI_FORM_USD_PER_MTOK_OUT` (defaults = the model's current list price, looked up when building), `OPENAI_FORM_USD_ESTIMATE` (default `0.10`). Add to `.env.example` + CLAUDE.md env table. Never print `.env` values.
- Event kinds: `contact_form_sent`, `contact_form_failed`, existing `contact_form_blocked`. Labels: timeline "Contact form sent" / "Contact form failed"; activity verb "contact form sent" / "contact form failed · not sent".
- Plain-English operator messages (no codes, no stack traces). No paid call runs in tests.
- Migration is `db/migrations/065_contact_form_runs.sql`; code tolerates it missing (routes answer "Run database update 065 first.").

## Review Focus

1. Double-click / two tabs pressing Send → exactly one submit (atomic `ready → sending` update; the loser gets "Already sending."). Test in Task 3.
2. A run stuck in `sending` > 10 min must become **`unknown`** ("may have been sent — check their page"), never `failed` + retry, because it may have submitted. Stuck `looking` → `failed`. Test in Task 1. (Refines the spec's "treated as failed" to honour its "never submit more than once" anti-goal — ruling.)
3. `contact_page_url` on another host (facebook.com, linktr.ee, a directory) → ignored; the finder searches the lead's own homepage instead. Test in Task 1.
4. Kill switch turned on, or the lead unsubscribed, between look and send → Send refused, nothing triggered. Test in Task 3.
5. Lead with no `website_url` but a `contact_page_url` → still works (host taken from the contact page). Test in Task 1.

---

### Task 1: Migration, workflow doc, pure rules

**Files:**
- Create: `db/migrations/065_contact_form_runs.sql`, `workflows/send_contact_form.md`, `web/lib/contact-form/rules.ts`
- Modify: `db/schema.sql` (append the table), `web/lib/email/send-simple.ts:59` (export `EARLY_STAGES`)
- Test: `web/lib/contact-form/rules.test.ts`

**Interfaces:**
- Produces:
  - `type RunStatus = "looking"|"ready"|"no_form"|"sending"|"sent"|"blocked"|"failed"|"unknown"`
  - `interface FormRun { id; lead_id; status: RunStatus; contact_url: string|null; form_shot_url; filled_shot_url; result_shot_url: string|null; sender_email; sender_name; subject; message; offer_key: string|null; fields: {name:string;value:string}[]|null; reason: string|null; usd: number|null; created_at: string; updated_at: string; sent_at: string|null }`
  - `senderName(fromName: string|null, email: string): string` — trimmed `fromName`, else local part capitalised.
  - `leadHost(lead: {website_url: string|null; contact_page_url: string|null}): string|null` — host of website_url, else of contact_page_url, `www.` stripped, lower-case.
  - `ownContactUrl(lead): string|null` — `contact_page_url` only if its host === `leadHost(lead)`.
  - `sameSite(url: string, host: string): boolean`
  - `effectiveStatus(run: FormRun, now: number): RunStatus` — `looking` older than 10 min (by `updated_at`) → `failed`; `sending` older than 10 min → `unknown`; else `run.status`.
  - `isActive(run, now): boolean` — effective status `looking` | `sending`.
  - `canReuseLook(run, now): boolean` — effective `ready` and `created_at` < 24 h old.
  - `STATUS_TEXT: Record<RunStatus, string>` — plain sentences (e.g. unknown → "We may have sent it but couldn't confirm. Check their page before trying again.").
  - `EARLY_STAGES` exported from `send-simple.ts` (unchanged values).

- [ ] **Step 1: Write the workflow doc** `workflows/send_contact_form.md` (objective, when to use, the three steps the operator sees, rules from Global Constraints, cost, what each outcome means, troubleshooting: no form / CAPTCHA / unknown). Project rule: workflow first.
- [ ] **Step 2: Write the migration** — table per spec "Data" with `status text not null check (status in (...the 8...))`, `fields jsonb`, `usd numeric(8,4)`, timestamps default `now()`, index on `(lead_id, created_at desc)`; header comment like `064`. Additive + idempotent (`create table if not exists`). Append the same DDL to `db/schema.sql`.
- [ ] **Step 3: Write failing tests** in `rules.test.ts`:

```ts
expect(senderName("Grace Lee", "grace@rp.rateupdigital.com")).toBe("Grace Lee");
expect(senderName(null, "grace@rp.rateupdigital.com")).toBe("Grace");
expect(senderName("  ", "ethan.b@x.com")).toBe("Ethan.b");
expect(leadHost({ website_url: "https://www.Joes.com/a", contact_page_url: null })).toBe("joes.com");
expect(leadHost({ website_url: null, contact_page_url: "https://joes.com/contact" })).toBe("joes.com");
expect(ownContactUrl({ website_url: "https://joes.com", contact_page_url: "https://facebook.com/joes" })).toBeNull();
expect(ownContactUrl({ website_url: "https://joes.com", contact_page_url: "https://www.joes.com/contact" })).toBe("https://www.joes.com/contact");
// stale rules (now = updated_at + 11 min)
expect(effectiveStatus(run("sending", 11), now)).toBe("unknown");
expect(effectiveStatus(run("looking", 11), now)).toBe("failed");
expect(effectiveStatus(run("sending", 9), now)).toBe("sending");
expect(canReuseLook(run("ready", 60 * 25), now)).toBe(false);
expect(canReuseLook(run("ready", 60), now)).toBe(true);
```
- [ ] **Step 4: Run** `npx.cmd vitest run lib/contact-form/rules.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 5: Implement** `rules.ts` (pure, no imports from db/services) and export `EARLY_STAGES`.
- [ ] **Step 6: Run** the same test — Expected: PASS. Then `npm.cmd run typecheck` — clean.
- [ ] **Step 7: Commit** `feat(db): contact form runs table, workflow and rules`

### Task 2: Browser + OpenAI computer-use service

**Files:**
- Create: `web/lib/services/contact-form-browser.ts`
- Modify: `web/scripts/contact-form-dryrun.ts` (import the shared helpers instead of its own copies; behaviour unchanged, still never submits)
- Test: `web/lib/services/contact-form-browser.test.ts`

**Interfaces:**
- Consumes: `sameSite`, `leadHost` from Task 1.
- Produces:
  - `lookForm(input: { siteUrl: string|null; contactUrl: string|null; host: string }): Promise<{ status: "ready"|"no_form"|"blocked"; contactUrl: string|null; shot: Buffer|null; reason: string|null }>` — Playwright only, no AI: use `contactUrl` or find one on `siteUrl` (the script's `findContactUrl`, same-host only), screenshot (full viewport, after 2.5 s), `ready` if a visible `textarea` or `input[type=email]` exists in any frame, `blocked` with "The page shows a CAPTCHA / bot check." if a recaptcha/hcaptcha/turnstile iframe or Cloudflare challenge text is visible and no form is, else `no_form`.
  - `fillAndSubmit(input: { contactUrl: string; host: string; businessName: string; senderName: string; senderEmail: string; subject: string; message: string; model: string; maxSteps?: number }): Promise<{ outcome: "sent"|"failed"|"unknown"|"blocked"|"no_form"; reason: string|null; fields: {name:string;value:string}[]; filledShot: Buffer|null; resultShot: Buffer|null; usage: { input_tokens: number; output_tokens: number } }>`
    - Phase A = the script's loop (network guard: only GET/HEAD/OPTIONS; submit clicks + Enter in inputs blocked), task text adapted: our name/email/subject/message, phone + unknown fields empty, a required field we can't truthfully fill → reply `BLOCKED:<field>`, CAPTCHA → `BLOCKED:captcha`. Anything but `FILLED` → return without submitting (`blocked` / `no_form`). `pending_safety_checks` → `blocked`.
    - Screenshot → `filledShot`, `collectFilled` → `fields`.
    - Phase B: lift the network guard, send the model "Click the form's send button once now.", allow the **first** submit click only (a counter; any later submit click/Enter is blocked), after it wait for network idle (max 10 s), screenshot → `resultShot`, then one more model call with the result screenshot asking for one word `SENT` / `ERROR:<text shown>` / `UNCLEAR` → `sent` / `failed` / `unknown`. The page navigating off-host after submit is fine (thank-you pages); clicking a link to another host before submit is blocked.
    - Sums `usage` over every OpenAI response.
  - `parseFillReply(text: string): { kind: "filled"|"no_form"|"blocked"; reason: string|null }` (pure)
  - `parseResultReply(text: string): { outcome: "sent"|"failed"|"unknown"; reason: string|null }` (pure)
  - `formUsd(usage, prices: { inPerMTok: number; outPerMTok: number }): number` (pure, rounded to 4 dp)
- [ ] **Step 1: Write failing tests** for the pure parts only:

```ts
expect(parseFillReply("FILLED")).toEqual({ kind: "filled", reason: null });
expect(parseFillReply("blocked: captcha")).toEqual({ kind: "blocked", reason: "captcha" });
expect(parseFillReply("NO_FORM")).toEqual({ kind: "no_form", reason: null });
expect(parseFillReply("I think it's done")).toEqual({ kind: "blocked", reason: "The AI couldn't confirm the form was filled." });
expect(parseResultReply("SENT")).toEqual({ outcome: "sent", reason: null });
expect(parseResultReply("ERROR: Please enter a valid phone")).toEqual({ outcome: "failed", reason: "Please enter a valid phone" });
expect(parseResultReply("hmm")).toEqual({ outcome: "unknown", reason: null });
expect(formUsd({ input_tokens: 1_000_000, output_tokens: 500_000 }, { inPerMTok: 3, outPerMTok: 12 })).toBe(9);
```
- [ ] **Step 2: Run** `npx.cmd vitest run lib/services/contact-form-browser.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the service (retry OpenAI 429/5xx as the script does via `lib/retry.ts`; on 401/402/quota use `failOpenAi(res, "contact_form")` so `service_health` is updated; log each call with `getLogger("contact-form")`). Point the dry-run script at the shared helpers.
- [ ] **Step 4: Run** the test — PASS; `npm.cmd run typecheck` — clean.
- [ ] **Step 5: Commit** `feat(pipeline): contact form browser service with one real submit`

### Task 3: Runs — start, gates, job steps, recording

**Files:**
- Create: `web/lib/contact-form/runs.ts`
- Test: `web/lib/contact-form/runs.test.ts`

**Interfaces:**
- Consumes: Task 1 rules/types, Task 2 `lookForm` / `fillAndSubmit` / `formUsd`, `EARLY_STAGES`, `isSuppressed`, `getSenderAccount`, `isMissingColumn` / missing-table check from `@/lib/db-errors`.
- Produces (all take an injectable `deps` object, defaults wired to db/services, like `send-simple.ts`):
  - `type StartRefusal = "no_table"|"no_website"|"suppressed"|"paused"|"busy"|"not_ready"|"no_mailbox"|"empty"`, with `START_TEXT: Record<StartRefusal,string>`.
  - `latestRun(leadId): Promise<(FormRun & { effective: RunStatus; text: string }) | null>`
  - `startLook(leadId, opts: { force?: boolean }): Promise<{ ok: true; run: FormRun; reused: boolean } | { ok: false; reason: StartRefusal; message: string }>` — refuses `no_website` (no `leadHost`), `suppressed`, `busy` (an active run); reuses `canReuseLook` run unless `force`; else inserts `looking` row. Does NOT trigger the job (the route does).
  - `startSend(leadId, input: { runId: string; senderEmail?: string; subject: string; message: string; offerKey?: string }): Promise<{ ok: true; run: FormRun } | { ok: false; ... }>` — gates in order: paused, suppressed, `empty` (blank message), `no_mailbox`, then an **atomic** update `status='sending'` + sender/subject/message/offer `where id=runId and lead_id=leadId and status='ready'`; zero rows → `not_ready` ("This form isn't ready to send — it may already be sending. Refresh."). Sender name via `senderName(account.fromName, account.email)`.
  - `runLookStep(runId): Promise<void>` and `runSendStep(runId): Promise<void>` — called by the job. Upload shots to bucket `lead-screenshots` at `contact-forms/<lead_id>/<run_id>-{form|filled|result}.png` (public URL saved on the row). Send step: `usd = formUsd(...)`; on `sent` → `sent_at`, event `contact_form_sent` (meta: run_id, contact_url, via, offer_key, subject, shots, usd), stage → `outreached` when in `EARLY_STAGES`, `inbox_status` `open` when none/null; on `blocked` → `contact_form_blocked` (meta.sent=false); on `failed` → `contact_form_failed`; on `unknown` → no event, status `unknown`. Any thrown error → status `failed` (look) / `unknown` (send, if phase B may have started) with a plain reason.
- [ ] **Step 1: Write failing tests** (fake deps, no network):

```ts
it("refuses a second Send while the first is sending (one submit only)") // atomic update returns 0 rows → not_ready
it("refuses Send when the kill switch is on")                      // paused → reason "paused", nothing updated
it("refuses Send when the lead unsubscribed after the look")       // suppressed
it("reuses a ready look from the last 24 h unless forced")
it("refuses a look while another run is active")                   // busy
it("records contact_form_sent and moves scraped → outreached on sent")
it("keeps stage replied when a form is sent to a replied lead")
it("saves unknown, not failed, when the send step throws after submit") 
it("answers no_table when migration 065 is missing")
```
- [ ] **Step 2: Run** `npx.cmd vitest run lib/contact-form/runs.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `runs.ts`.
- [ ] **Step 4: Run** the test — PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(pipeline): contact form runs with send gates and recording`

### Task 4: Job mode + API route

**Files:**
- Modify: `web/scripts/cloud-run-job.ts` (new `if (mode === "contact-form")` block: reads `LEAD_ID`, `RUN_ID`, `STEP`; `look` → `runLookStep`, `send` → `runSendStep`; not wrapped in `runTracked`)
- Create: `web/app/api/leads/[id]/contact-form/route.ts`
- Test: `web/app/api/leads/[id]/contact-form/route.test.ts` (zod body schema only, exported as `contactFormBody`)

**Interfaces:**
- Consumes: Task 3 `latestRun`, `startLook`, `startSend`, `START_TEXT`.
- Produces:
  - `GET` → `ok({ run, estimateUsd })` (`run` = `latestRun` or null; `estimateUsd` from `OPENAI_FORM_USD_ESTIMATE`, default 0.10).
  - `POST` body `contactFormBody = z.discriminatedUnion("action", [{action:"look", force?: boolean}, {action:"send", runId: uuid, senderEmail?: email, subject: string max 300, message: string 1..5000, offerKey?: string}])`. On ok → `triggerJob({ MODE: "contact-form", STEP, LEAD_ID, RUN_ID }, { oidcToken, timeoutSeconds: 600 })` (oidc token as in the build route); trigger failure → set the run `failed` ("Couldn't start the worker. Try again.") and `fail(msg, 502)`. Refusal → `fail(message, 409)`. Reused look → no trigger. Cloud Run not configured (local dev) → `fail("Contact forms need the Cloud Run worker (not available locally).", 503)`.
- [ ] **Step 1: Write failing test** for `contactFormBody`: accepts `{action:"look"}`, accepts a full send, rejects send with empty message, rejects unknown action.
- [ ] **Step 2: Run** `npx.cmd vitest run "app/api/leads/[[]id]/contact-form"` (or the file path) — FAIL.
- [ ] **Step 3: Implement** the route and the job block (job: log `job.start` / `job.done` like other modes).
- [ ] **Step 4: Run** test — PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(api): contact form look and send route and job mode`

### Task 5: The window, Contact card button, timeline labels

**Files:**
- Create: `web/components/outreach/ComposeFields.tsx` (extracted from `SimpleEmailModal`: mailbox picker, offer list + saved templates, subject, message, Regenerate, Save as template — props in/out, no fetching of its own beyond what the modal already did), `web/components/outreach/ContactFormModal.tsx`
- Modify: `web/components/outreach/SimpleEmailModal.tsx` (use `ComposeFields`; behaviour unchanged), `web/components/leads/ContactCard.tsx` (button "Contact form" next to "Contact page", shown when the lead has `website_url` or `contact_page_url`), `web/lib/crm/timeline-merge.ts:36`, `web/components/ActivityFeed.tsx:67`, `web/components/OutreachLogTable.tsx:24` (labels for `contact_form_sent` / `contact_form_failed`; screenshots link like the existing dry-run rows)
- Test: `web/lib/crm/timeline-merge.test.ts` (add label cases)

**Interfaces:**
- Consumes: Task 4 GET/POST; existing `GET /api/leads/:id/send-email` (compose context), `GET /api/email-accounts`, `POST /api/leads/:id/send-email/regenerate`.
- Produces: `ContactFormModal({ leadId, onClose, onDone })`. Behaviour: on open GET; if no reusable ready run → POST look; poll GET every 4 s while `looking`/`sending`, stop after 5 min with "Still working — close this and check back in a few minutes."; show form screenshot + "Open page" link + "Look again" (POST look force); compose fields; "Cost: about N¢"; **Send via their form** disabled unless status ready and message non-empty; after Send show filled + result screenshots and `STATUS_TEXT` sentence (server sends `text`). Refusals shown as the server's sentence.
- [ ] **Step 1: Write failing test**: timeline label for `contact_form_sent` is "Contact form sent", `contact_form_failed` is "Contact form failed".
- [ ] **Step 2: Run** `npx.cmd vitest run lib/crm/timeline-merge.test.ts` — FAIL.
- [ ] **Step 3: Implement** labels, `ComposeFields` extraction, `ContactFormModal`, Contact card button.
- [ ] **Step 4: Run** the full suite `npx.cmd vitest run` — all pass; `npm.cmd run typecheck` and `npm.cmd run lint` — clean.
- [ ] **Step 5: Manual check** `npm.cmd run dev`, open a lead: Send email window still composes and shows templates exactly as before; Contact form button opens the window and shows the local-dev 503 sentence (no Cloud Run locally).
- [ ] **Step 6: Commit** `feat(web): contact form window on the lead page`

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (How the App Works note, routes table row `/api/leads/:id/contact-form`, env rows, migrations "latest = 065", job MODE list), `.env.example`, `web/lib/assistant/knowledge.ts` (how to send a contact form, what the outcomes mean), `web/README.md` if it lists job modes.
- [ ] **Step 1:** Update the docs; run `npx.cmd vitest run lib/assistant` (knowledge tests, if any) and typecheck.
- [ ] **Step 2: Commit** `docs(docs): contact form send in claude.md, env and assistant guide`

**After the plan (operator, not code):** run migration 065 in Supabase; redeploy the Cloud Run job (`bash scripts/deploy-cloud-run-job.sh` from the repo root) — only when the operator says so; first real sends on 2–3 leads.
