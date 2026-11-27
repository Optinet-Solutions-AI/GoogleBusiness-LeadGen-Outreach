# Run a Brain job

Since 26 Nov 2026 (Meny: "the system will have to send automatically, so I don't need to get into each lead").
Design: `docs/superpowers/specs/2026-11-26-brain-jobs-design.md`. Migration **074**.

## What it is

The **Brain** page (`/brain`) takes a job in plain words, asks a few settings as choices, finds the leads, decides per
lead whether and how to contact it, shows ONE plan to approve, then sends by itself: email, contact form, AI call.
The win it chases is **a reply**. Answering replies on its own is a later project.

The AI decides at two fixed points only: understanding the command, and judging each lead (contact or skip, which
offer, which channels, one sentence of why). It only chooses among moves the code lists; everything it returns outside
those lists is replaced by the standard rule. Sending, timing, limits and money are code.

## Steps (operator)

1. **Brain** → type the job:
   - "Get me 100 plumbers in Texas and work them" (a new Google Maps search, 300 leads at most), or
   - "Work the leads from the Austin dentists batch" (an existing finished batch, no search).
2. Answer the questions (suggested answers are preselected): **budget**, **channels** (email / contact form / AI call),
   **how many a day** (default 10 emails, 10 forms, 5 calls), **follow-up emails** (default none), and **EU/UK** only
   when the job is there (default out). Press **Start**.
3. Wait for the search and the judging (the page updates by itself).
4. **Review the plan**: untick leads or channels, change an offer, tick a skipped lead back in when it can be reached,
   view the emails. **Approve ticked** starts it. Nothing is sent before that; a call only goes out for a row whose ☎
   is still ticked.
5. It runs by itself. The job page shows emailed / forms / calls / wins, money spent of the budget, and leads that
   **need a person** (a contact form with a CAPTCHA: copy the message, send it yourself, "I sent it myself").
   **Pause / Resume / Cancel / Raise budget** are on the job.

## Lead score (27 Nov 2026)

Each lead's OpenAI lead score (workflows/score_leads.md) goes into what the AI reads ("Lead score: 82/100 (Hot). Why:
…"), and the plan lists contact rows highest score first (unscored after). Emails go out highest score first when the
daily limit decides who goes first. The score never skips a lead by itself.

## The order per lead

- Day 0: the first email (if ✉) and the contact form (if ticked; for a lead with no email it is the first touch).
- Day 2: the AI call (if ☎), unless they answered or were stopped.
- Day 4 / 8 / 12: follow-up emails, if chosen.

A human reply or an "interested" call is a **win**: everything else for that lead stops and it lands in the Inbox as
today. Unsubscribe, "not interested", do-not-call stop every channel. A bounce ends email only.

## Rules the Brain can't change

- Unsubscribed / do-not-call / not-interested leads are never contacted (re-checked before each form and call).
- CAPTCHAs are never solved. Never a second form submit, never a re-dial after a lost response.
- Never a website pitch to a business with a good website; never a call to a review-site lead or a GDPR country.
- Never past the job's budget: the next paid step that would cross it pauses the job. The budget covers the search,
  the AI checks, the judging (about 1 cent a lead) and contact forms (about 10 cents each). AI calls are limited by
  number (Voizo bills them, not this app).
- Mailbox warm-up caps, the email check, the kill switch (`EMAIL_SENDING_PAUSED_UNTIL`), Voizo's 100 calls a day and
  calling hours all still apply.
- A batch that is already being emailed can't be given to the Brain until that is paused or cancelled. A lead is in
  one Brain job at a time and is never re-emailed.
- Demo websites are never built automatically. The Brain sends the existing tested emails; it does not rewrite them.

## How it runs (developer)

| Step | Where |
|---|---|
| Command → questions | `POST /api/brain/jobs` → `lib/brain/jobs.ts` `createJob` (OpenAI `lib/services/openai-brain.ts`, model `OPENAI_BRAIN_MODEL`) |
| Start | `PATCH /api/brain/jobs/:id` → `startJob`: a tagged batch (`batches.brain_job_id`) on Cloud Run `MODE=batch`, or `MODE=brain STEP=plan` for an existing batch |
| Judging | `lib/brain/plan.ts` `buildPlan` (hook at the end of the batch run) → `brain_job_leads`, status `review` |
| Approve | `POST /api/brain/jobs/:id/approve` → `approvePlan`: `startBatchEmail({only})` + each lead's first-touch / call-due time |
| Run | automation tick part `brainJobs` → `lib/brain/runner.ts`: contact forms (`contact_form_runs.source='brain'`), calls via `queueQuickCall`, stops / wins, done |
| Control | `POST /api/brain/jobs/:id/control` → `lib/brain/control.ts` |

Pure rules with tests: `lib/brain/{rules,command,judge,schedule,due,view}.ts`.

## Going live

1. Run `db/migrations/074_brain_jobs.sql`, push, redeploy the Cloud Run job.
2. Emails go without anything new (`email-sequence-tick` runs). **Contact forms and calls need the Cloud Scheduler job
   "automation-tick"**, which is created only when the operator says so. Before creating it, check nothing else would
   start with it: no batch waiting to auto-email, no active Daily batches row, no batch email with contact forms on.

## When it fails

- "The Brain needs database update 074" → run the migration.
- The plan says "AI wasn't available, so this plan uses the standard rules" → OpenAI key / credit; the plan is still
  usable (the usual offer per lead, every available channel).
- A job paused with "Budget reached" → Raise budget, then Resume.
- Forms / calls not going out → is "automation-tick" created? Is the job running (not paused)? Inside Mon–Fri 9–17?
