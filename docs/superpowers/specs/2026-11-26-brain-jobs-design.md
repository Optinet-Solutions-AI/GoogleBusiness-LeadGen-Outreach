# Brain jobs — design

Date: 26 Nov 2026 · Status: draft for operator approval · Project 1 of 2 (project 2 = "Brain replies", designed later)

## Intent

Meny (the owner) doesn't want to open each lead to reach it: "the system will have to send automatically". The
operator wants an **AI "brain"** in charge of outreach: you give it a job in plain words ("get me 100 plumbers in
Texas and work them"), it asks a few settings as tick-boxes, finds the leads, decides per lead whether and how to
contact it, shows its plan once for approval, then sends by itself: email, contact form and AI call, in order.

The win the brain chases is **a reply** (not a booked meeting, for now).

Most of the sending machinery exists (batch emails, contact-form sends, the Voizo call queue, the sequence tick).
What is new: plain-language commands, the per-lead judgment, one plan to approve, and the automatic channel order
including calls.

## Goals

- A **Brain** page (`/brain`, in the sidebar) with a command box, the list of jobs, and one job's view.
- Two commands in v1:
  1. **Find and work**: "Get me 100 plumbers in Texas and work them" → a new Google Maps search (Apify), then work it.
  2. **Work an existing batch**: "Work the leads from the Austin dentists batch" (or picked from a list) → no search.
  Anything else → a fixed reply saying what it can do; nothing happens.
- **Questions before it starts**, shown as choices / tick-boxes with a suggested answer preselected (like Claude's
  question windows), never free typing unless the command itself was unclear (e.g. no place given):
  - **Budget** for this job ($10 / $20 / $50 / other), next to the estimate it is based on.
  - **Channels**: Email · Contact form · AI call (each a tick; a channel that isn't connected is greyed with why).
  - **Per day**: emails (default 10), contact forms (default 10), calls (default 5).
  - **Follow-up emails**: 0–3 (default 0, as today).
  - **EU/UK leads**: asked only when the job's place or batch is in the EU / EEA / UK; default out.
- **The plan, approved once.** After the search, the brain judges each lead and shows a table: a tick per lead,
  the business, its website verdict, the offer, a tick per channel (✉ form ☎), and one sentence of why. Skipped
  leads are listed unticked with the reason. The operator can untick leads or channels, tick a skipped lead back in
  (when it can be reached at all), change the offer among the allowed ones, and view the email for each offer.
  **Approve ticked** starts it; **Cancel** drops the job. Nothing is sent before Approve.
- **The ☎ tick is the "approved by hand" Meny asked for**: a call is only ever placed for a row left ticked.
- **Then it runs by itself**, per lead, in this order (operator can correct; see "Calls I made"):
  - Day 0: the first email (if ✉) and the contact form (if ticked; for a lead with no email it is the first touch).
  - Day 2: the AI call (if ☎), unless they answered or were stopped.
  - Day 4 / 8 / 12: follow-up emails, if chosen.
- **It stops per lead** on: a human reply or an "interested" call = **a win** (everything else for that lead stops,
  the lead is marked hot in the Inbox exactly as today, the job counts it); unsubscribe, "not interested",
  do-not-call, wrong number = stop every channel for that lead. A bounce ends email for that lead only (form and
  call still go).
- **The job view shows progress**: emailed / forms sent / calls placed / wins, money spent of the budget, leads
  that need a person (a contact form blocked by a CAPTCHA: the existing copy-message hand-off), and Pause / Resume /
  Cancel.
- Every decision is saved with its reason, so project 2 (review + corrections, "training") can build on it.

## Non-goals (this project)

- **Answering replies** on its own, the Brain log and corrections / standing rules ("training"): project 2.
- The brain choosing niches or cities by itself: it works on commands.
- Other sources as a command (closures, exhibitors, review sites): their batches can still be worked with
  command 2.
- AI rewriting each email per lead: v1 sends the existing tested emails (ready-made or the saved template that is
  that offer's starting email / wording-test version), so Results and wording tests keep meaning something.
- Building demo websites automatically: Build stays a person's click. Website offers go out with the demo link
  when a demo exists, else in the existing "want a free sample?" wording.
- Booking meetings, calendars, SMS.

## Anti-goals (a failure even if it works)

- **The brain can never do what the app wouldn't let a person do.** It only chooses among moves the code offers;
  it has no direct access to sending, dialling or spending.
- **Never contact a lead that unsubscribed, bounced (by email), or said don't-call / not interested.** Existing
  suppression applies to every channel, checked again right before each send, form and call.
- **Never solve or get around a CAPTCHA / bot check.** Blocked form → a person (existing hand-off).
- **Never pitch a website to a business with a good one**; never call a review-site lead; never dial a GDPR
  country (even with "EU/UK in" ticked, which covers email and forms only).
- **Never spend past the job's budget.** The next paid step that would cross it pauses the job and says so.
- **Never send anything before Approve**, and never a call without its ☎ tick.
- **Never a second contact-form submit or a re-dial after a lost response** (existing rules).
- **No lead worked by two jobs at once**, and never re-emailed when already emailed by an earlier campaign.

## Constraints (existing, unchanged)

- Kill switch `EMAIL_SENDING_PAUSED_UNTIL` stops emails and forms. Mailbox warm-up caps, the verification gate
  (`valid` / `catch-all` / `likely`) and head-office-inbox rules apply under the job's own per-day number.
- Voizo: 100 calls a day, one live call at a time, the campaign's calling hours, `shadow: true` required.
- Email and contact-form windows: Mon–Fri 9–17 in the batch's time (as batch emails).
- Long work runs on the Cloud Run job, never in a Vercel route (60 s).
- Paid calls only inside an approved budget; the search needs the estimate shown first (it is, in the questions).
- Response envelope `{ success, data | error }`, thin routes, logic in `lib/`, file headers, tests, workflow doc first.

## Approaches

- **A. A free-roaming agent**: the AI gets the app's actions as tools and works out each step. Closest to "master
  of the system", least predictable: one bad step emails real businesses or spends money, and it can't be tested
  before it touches them. Rejected.
- **B. The brain decides, the app does (picked by the operator, 26 Nov 2026).** The AI makes judgment calls at fixed
  points (understand the command, judge each lead); everything mechanical (order, timing, limits, sending) is the
  existing, tested machinery. Every decision is saved with its reason. About 1 cent per lead judged.
- **C. Rules only**: switch on the existing automation and add the call step. Cheapest, but no commands, no
  per-lead judgment, nothing to review. Rejected: it isn't the brain that was asked for.

## How it works

### 1. Understanding the command (one OpenAI call, in the route)

`POST /api/brain/jobs {command}` → OpenAI (strict JSON; model `OPENAI_BRAIN_MODEL`, default `gpt-5.4-mini`, the
`OPENAI_API_KEY` already in Vercel) returns `{intent: find_and_work | work_batch | other, niche, place,
country_code, count, batch_hint, missing}`. `other` → the fixed "what I can do" reply, no job. Something missing
(no place, no count) → the job asks that one thing in words. `work_batch` → matched to a finished batch (list to
pick from when unsure). Count is capped at the Apify cap (300). A job row is created in state `asking`.

### 2. Questions → `settings`

The route returns the questions with defaults and the estimate (from `lib/pricing.ts`: search + AI Lookup + website
check for the count; + brain judging ≈ $0.01 a lead; + contact forms up to the leads likely to get one × $0.10).
A budget below the search + checks estimate is refused with the numbers. Answers are saved on the job
(`settings`: budget, channels, per-day numbers, follow-ups, include_eu).

### 3. Search (find-and-work only)

`createBatch` (Apify, the count, AI Lookup on, **no** auto-email) tagged with the job, run on Cloud Run
(`MODE=batch`) exactly as a normal batch: stage 1 with AI Lookup and the AI website check. State `searching`.

### 4. Judging = building the plan (Cloud Run)

When the job's batch finishes (hook at the end of the batch run, same execution), or straight away for an existing
batch (`MODE=brain STEP=plan JOB_ID`). State `planning` → `review`.

For each qualified lead, **code first** works out the facts and the allowed moves:
- allowed **offers** from the segment rules (`routeOffer` / `offerFor`: e.g. good website → AI services only;
  closure → buy inventory; exhibitor → stand; review site → reputation);
- allowed **channels**: email when the batch-email rules would send to it (`skipReason`); contact form when it has
  an own-site contact page or website (`formLeadOk`); call when `callBlock` allows and Voizo has a script for an
  allowed offer; each only if the job has that channel on;
- leads with no allowed channel, already contacted, suppressed, or in another active job are **skipped by code**
  with the plain reason, with no AI call.

Then **one OpenAI call per remaining lead** (strict JSON) gets: name, category, place, rating and review count,
the website check (verdict, reasons, what to pitch), the AI Lookup summary, which contacts exist, and the allowed
offers and channels. It returns `{contact: yes | no, offer, channels[], reason}` (reason = one plain sentence).
Code validates it: an offer or channel outside the allowed lists, or an unusable answer, falls back to the
rule-based default (the offer Send email would start on, every allowed channel) and the row is marked "default
used". OpenAI unavailable → the whole plan is built from the defaults, with a visible notice on the job.

Rows are saved in `brain_job_leads`. Judging cost is added to the job's spend.

### 5. Review and Approve

The plan table as described in Goals. `POST /api/brain/jobs/:id/approve {rows}` saves the ticks, then starts:
- an **email campaign** for the job (the batch-email format: `call_campaigns` email_mode `offers`, the job's
  emails-per-day, follow-ups) and per ticked lead the written email plan (`buildLeadPlan` →
  `seq_copy_overrides` + `seq_max_step`), staggered over the window like "Email this batch". The existing
  sequence tick sends them (first email and follow-ups);
- **each ticked lead's own schedule** in `brain_job_leads` (the brain keeps it, not the sequence state): a
  **first-touch time** for every lead. A lead with an email takes its email's send slot. A lead with no email
  (form or call only) is spread over the same window at the job's forms-per-day rate, so 100 of them never fall due
  on one day. The call's due time is first touch + 2 days.
- **call campaigns** for the job are created only when the first call falls due: one per country among its leads
  (the standing "Quick calls (AI) · <CC>" pattern: that country's timezone and hours), channel `call`.
State `running`.

A job on an existing batch is **refused** (with the reason) when that batch already has a running batch email or is
waiting to auto-email: pause or cancel that first. Leads already emailed or in a sequence are skipped by code.

### 6. The automatic run (a new part of the automation tick, every 15 min)

For each running job, inside its per-day numbers, budget and windows:
- **Contact forms**: for ticked leads whose first-touch time has passed: the existing look → send steps with the
  offer's email as the message (`contact_form_runs.source = 'brain'`), at most 2 per tick, each lead once, and no
  more than the job's forms-per-day (counted per job from its own `'brain'` runs). The existing 10-a-day limit
  stays what it is: the limit of batch emails' automatic forms (`source = 'auto'`); it does not count brain forms.
  Blocked / no form → listed under "needs a person".
- **Calls**: a ticked lead whose call is due and that hasn't answered or been stopped is added to the job's call
  campaign for its country with the Voizo script of its offer (`campaign_leads.voizo_campaign_id`), due now. The
  job adds at most its calls-per-day new leads a day (the limit is applied here, when queueing: the call worker has
  no per-campaign daily limit, only Voizo's 100 a day shared by everything). The existing call worker
  (`voizo-call-tick`, already running every 15 min) dials it (hours, one at a time, retries, talking points,
  results) and the existing result routing applies.
- **Stops and wins**: every tick the runner re-reads each open lead (stage, suppression, call result, sequence
  state) rather than trusting other handlers to tell it. A stop reason skips the lead's remaining steps and is
  recorded. A reply or an interested call marks the row a win. On "not interested", do-not-call or unsubscribe the
  runner itself stops the lead's remaining emails and removes its queued call, whatever the other handlers did.
- **Done**: when every ticked lead has finished its steps (or stopped), the job is `done`.

### 7. Budget, pause, cancel

Spend = the search + checks **estimate** for the batch (`batches.estimated_cost_usd` scrape part: the app records
no actual cost for a search; an existing batch counts 0, it was already paid) + judging (measured from the OpenAI
usage) + contact-form costs (`contact_form_runs` cost, measured). AI calls are
limited by number, not dollars: this app is not billed for them (Voizo is) and has no price for them. A step that
would cross the budget pauses the job ("budget reached", with "raise budget"). **Pause** holds emails (campaign
paused), forms and new calls; **Resume** continues; **Cancel** also stops the remaining emails and removes queued
calls. What was already sent stays in each lead's history.

## Data (migration 074)

- `brain_jobs`: command, intent, status (`asking | searching | planning | review | running | paused | done |
  cancelled | failed`), settings (jsonb), batch_id, email_campaign_id, call_campaign_id, spent_usd, notice,
  timestamps.
- `brain_job_leads`: job, lead, decision (`contact | skip`), offer, channels, reason, source (`ai | rule |
  default`), approved ticks, per-channel progress (first touch time, form state, call due / state), outcome.
- `batches`: the job that made it. Code tolerates 074 missing (the page says to run it).

## Left to the builder

File layout under `lib/brain/` (pure rules + tests: allowed moves, validating the AI's answer, what is due,
budget), the prompt wording, the exact API shapes beyond those named, polling vs refresh on the job view, how the
plan table pages for 300 leads, whether Approve's set-up runs in the route or on Cloud Run, the estimate's
"leads likely to get a form" guess, and reusing the Ask-how speech input for the command box (optional).

Also in scope: workflow `workflows/run_brain_job.md` (written first), the assistant guide (`knowledge.ts`),
CLAUDE.md, `.env.example` (`OPENAI_BRAIN_MODEL`), a QA checklist that runs a whole job against test leads only
(the operator's own email, phone and the RateUp test contact page).

## Going live

1. Migration 074, push, redeploy the Cloud Run job.
2. The contact-form and call steps need the Cloud Scheduler job **"automation-tick"**, which has never been
   created (kept off for QA). It is created only when the operator says so. Before that: check that nothing else
   would start with it (no batch waiting to auto-email, no active Daily batches row, no batch email with contact
   forms on), or that the operator wants those too. Until it exists, a job's emails still go (the sequence tick
   runs) but its forms and calls wait.
3. Already running, nothing to create: `email-sequence-tick` (every 3 min), `voizo-call-tick` (every 15 min),
   `inbox-sync-tick` (every 5 min).

## Calls I made (operator to confirm while reading)

1. The order: day 0 email + contact form, day 2 call, follow-ups on day 4 / 8 / 12.
2. v1 sends the existing tested emails; the brain does not rewrite each one.
3. v1 commands: a new Google Maps search, or an existing batch.
4. Demo websites are never built automatically.
5. The budget covers search, AI checks and contact forms; calls are limited by number.
6. A bounce ends email for that lead only; its form and call still go.
7. Defaults: 10 emails, 10 contact forms, 5 calls a day; follow-ups off; EU/UK out.
8. Forms and calls need the "automation-tick" job created (your word).
9. Per-day numbers are per job. Brain forms don't count toward the batch emails' own 10-a-day; calls from all
   jobs share Voizo's 100 a day.
10. A lead with no email gets its day 0 spread over the days at the forms-per-day rate.
11. The search counts toward the budget at its estimate (the app records no actual search cost).
12. A batch that is already being emailed can't be given to the brain until that is paused or cancelled.
