# Run the outreach on its own (automation)

**Owner code:** `web/lib/automation/rules.ts` (pure rules), `web/lib/automation/{auto-email,auto-contact-forms,schedules,tick}.ts`,
the worker mode `MODE=automation` (Cloud Run job `lead-batch-runner`), run every 15 minutes by the Cloud Scheduler
job `automation-tick`. Migration **068**. Operator decisions, 24 Nov 2026.

## The four parts (plus Brain jobs)

0. **Brain jobs** (26 Nov 2026, `workflows/run_brain_job.md`): the tick also moves every running Brain job forward
   (`lib/brain/runner.ts`, part `brainJobs`, before the automatic contact forms): stops and wins, due contact forms
   (the job's own forms-per-day, 2 per run over all jobs, never past the job's budget) and due calls (queued in the
   standing "Quick calls (AI)" campaign). A job's emails don't need this tick; its forms and calls do.

1. **Auto-start batch emails.** A batch made with "Email this batch automatically" ticked (OFF by default in the New
   batch form while QA tests, operator decision 24 Nov 2026; always on for scheduled batches) starts its batch email **24 hours after it finishes**, with the batch
   email defaults: 10 first emails a day, follow-ups off, EU / UK left out, head-office emails skipped, contact forms on.
   The batch page shows when it starts, with **Cancel**. If nothing can be emailed it says why ("skipped").
2. **Automatic contact forms.** For a running batch email with contact forms on: the batch's leads with **no email**
   but a contact form on their own website get the same offer through the form. **At most 10 a day** (all batches
   together), Mon–Fri 9:00–17:00 in the batch's time, about 10 cents each. Skipped: rejected, unsubscribed, past first
   contact, emailed before, EU / UK (unless the batch email includes them), and any lead that already had a contact-form
   attempt (each lead is tried once). A form with a **CAPTCHA is never solved**: that lead is left for a person.
   A batch where nobody has an email still starts (contact forms only). In the hand-started "Email this batch" window
   the contact-forms switch is **off** by default; the automatic start turns it on. Each attempt is marked automatic
   when created; the 10 a day, the hours and the campaign's status are re-checked right before each paid send.
3. **Scheduled batches.** Batches page → **Daily batches**: a list of niche + city. **Each weekday** (from 6:00
   New York time) the next one in the list runs as a **100-lead** batch (Apify + AI Lookup), with auto-start email on.
   **Monthly cap $40** (estimated cost of scheduled batches this calendar month): when the next batch would pass it,
   no more scheduled batches run that month (the cap counts the search + AI Lookup + AI website check estimate, about $0.96 a batch, not
   demo building, which is never automatic). One per New York day is enforced by the database (`batches.scheduled_for`
   is unique); the run that creates it does nothing else that time. Pause or remove a row any time.
4. **CAPTCHA hand-off.** In the Contact page window, a form that is protected (CAPTCHA) shows the message ready to
   copy and a button to open their page: paste it, tick the box yourself, send, then press **I sent it myself**
   (records it like a sent form: timeline + stage "outreached").

## Status (24 Nov 2026)

Built and deployed, but **switched off**: the `automation-tick` Cloud Scheduler job has not been created yet, at the
operator's request while QA tests (QA changes a lead's email to her own before testing; leads must never be emailed
by themselves meanwhile). Create it when testing is done (same shape as `voizo-call-tick`, `MODE=automation`, every
15 minutes).

## Stopping it

- One batch: **Cancel** on its batch page before it starts; after, pause / delete its "Batch email · …" campaign
  (that also stops its contact forms).
- Everything at once: the kill switch `EMAIL_SENDING_PAUSED_UNTIL` (emails and contact forms), or pause the
  `automation-tick` Cloud Scheduler job (no auto-starts, contact forms or scheduled batches).

## When it fails

- Nothing happens → is `automation-tick` running (Cloud Scheduler)? Migration 068 applied?
- "Batch emails need database update 067/068" → run the migration in Supabase.
- A scheduled batch didn't run → this month's cap reached, no active row, or it's a weekend.
