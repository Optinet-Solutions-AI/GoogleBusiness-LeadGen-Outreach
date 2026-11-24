# Run the outreach on its own (automation)

**Owner code:** `web/lib/automation/rules.ts` (pure rules), `web/lib/automation/{auto-email,auto-contact-forms,schedules,tick}.ts`,
the worker mode `MODE=automation` (Cloud Run job `lead-batch-runner`), run every 15 minutes by the Cloud Scheduler
job `automation-tick`. Migration **068**. Operator decisions, 24 Nov 2026.

## The four parts

1. **Auto-start batch emails.** A batch made with "Email this batch automatically" ticked (the default in the New
   batch form; always for scheduled batches) starts its batch email **24 hours after it finishes**, with the batch
   email defaults: 10 first emails a day, follow-ups off, EU / UK left out, head-office emails skipped, contact forms on.
   The batch page shows when it starts, with **Cancel**. If nothing can be emailed it says why ("skipped").
2. **Automatic contact forms.** For a running batch email with contact forms on: the batch's leads with **no email**
   but a contact form on their own website get the same offer through the form. **At most 10 a day** (all batches
   together), Mon–Fri 9:00–17:00 in the batch's time, about 10 cents each. Skipped: rejected, unsubscribed, past first
   contact, emailed before, EU / UK (unless the batch email includes them), and any lead that already had a contact-form
   attempt (each lead is tried once). A form with a **CAPTCHA is never solved**: that lead is left for a person.
3. **Scheduled batches.** Batches page → **Daily batches**: a list of niche + city. **Each weekday** (from 6:00
   New York time) the next one in the list runs as a **100-lead** batch (Apify + AI Lookup), with auto-start email on.
   **Monthly cap $40** (estimated cost of scheduled batches this calendar month): when the next batch would pass it,
   no more scheduled batches run that month. Pause or remove a row any time.
4. **CAPTCHA hand-off.** In the Contact page window, a form that is protected (CAPTCHA) shows the message ready to
   copy and a button to open their page: paste it, tick the box yourself, send, then press **I sent it myself**
   (records it like a sent form: timeline + stage "outreached").

## Stopping it

- One batch: **Cancel** on its batch page before it starts; after, pause / delete its "Batch email · …" campaign
  (that also stops its contact forms).
- Everything at once: the kill switch `EMAIL_SENDING_PAUSED_UNTIL` (emails and contact forms), or pause the
  `automation-tick` Cloud Scheduler job (no auto-starts, contact forms or scheduled batches).

## When it fails

- Nothing happens → is `automation-tick` running (Cloud Scheduler)? Migration 068 applied?
- "Batch emails need database update 067/068" → run the migration in Supabase.
- A scheduled batch didn't run → this month's cap reached, no active row, or it's a weekend.
