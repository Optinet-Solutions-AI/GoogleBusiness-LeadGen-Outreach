# Email a whole batch (a few a day, automatically)

**Owner code:** `web/lib/campaigns/batch-email.ts` (pure rules: who, which email, the plan),
`web/lib/campaigns/batch-email-plan.ts` (preview + start), `app/api/batches/[id]/email/route.ts`,
`components/batches/BatchEmailButton.tsx`, the email scheduler `web/lib/pipeline/sequence-scheduler.ts`
(Cloud Scheduler `email-sequence-tick`, every 3 minutes, Cloud Run `MODE=sequence`). Migration **067**.

## What it is

A finished batch page has **Email this batch**. It shows who would get an email, who is skipped and why, and for each
offer the email that will go out (with a sample for one real lead). **Start sending** sets it up; nothing is sent at
that moment. The scheduler then sends the first emails a few at a time, on weekdays.

## Rules (operator decisions, 24 Nov 2026)

- **Who:** the batch's qualified leads with an email that were never emailed before. Skipped (with the reason shown):
  rejected by the filters, no email, unsubscribed / do not contact, already replied / in a meeting / closed, already
  in another sequence or campaign, an email that failed the check, a local business whose main email AI Lookup
  marked as a head office's or franchise's, and EU / EEA / UK leads (GDPR rule) unless **Include EU / UK leads** is on.
- **Never-checked emails** are checked right before their first email (free built-in check; a paid checker only when
  one has credits, under 1 cent); a bad one is skipped then.
- **Which email:** the ready-made email Send email would pick for the lead's offer, or a saved template chosen per
  offer. A running wording test for that offer takes turns between A and B; otherwise the last test's winner.
  A saved template that can't be filled for a lead (a missing demo link, an unknown placeholder) falls back to the
  ready-made email for that lead. Sent exactly as written: plain text, no screenshot, no translation.
- **How many:** 10 first emails a day by default (1–100 in the window). The first emails are spread over the day;
  the scheduler also holds any beyond the limit within 24 hours. Each mailbox still stays within its warm-up cap.
- **When:** Monday to Friday, 9:00–17:00 in the batch's main country time zone.
- **Follow-ups:** off by default; 1, 2 or 3 (day 4, 8, 12) when chosen, from the same mailbox. Ready-made emails send
  them as "Re: <subject>"; a saved template's follow-ups keep their own subjects (migration 070).
- **Stops:** a reply, bounce, unsubscribe or spam complaint stops the emails to that lead.
- **Mailboxes:** every active mailbox, taking turns (reputation emails from the OptiRate mailboxes, as in Send email).
- **Contact forms (optional, off by default here):** leads with no email get the offer through their own-site contact
  form, at most 10 a day in all (see `workflows/run_automation.md`; on by default when the batch email starts by itself).
- One batch email per batch at a time (active, paused or being set up). Only the leads that really got their emails
  set up are the campaign's members.
- Safety checks at each send (review, 24 Nov 2026): a lead emailed some other way since (Send email) or moved past
  first contact on the CRM board is dropped; a lead whose mailbox is at today's limit waits on its own (the others go
  on); a lead whose mailbox was removed is dropped (re-run a batch email later to reach it); an address that still
  can't be checked is dropped instead of being re-checked every day. A first email never moves a stage backwards.

## Pause / stop

It is a normal email campaign named "Batch email · <niche> · <city> · <date>" on the **Campaigns** page: Pause, Resume,
Mark done or Delete there (Mark done and Delete stop its emails). Launch refuses a batch email (it would replace the
written emails with the classic sequence). (The campaign page's sequence-wording editor doesn't apply to batch emails: their wording is
written per lead when it starts.)

## Results

Every email is labelled with what it was, so Outreach → Templates → **Results** counts it under its email, and a
wording test counts its A / B sends.

## When it fails

- "Batch emails need database update 067" → run `db/migrations/067_batch_email.sql` in Supabase.
- "already being emailed" → a batch email for this batch is still active: pause or finish it on the Campaigns page.
- Nothing goes out → check the `email-sequence-tick` scheduler is running (Cloud Scheduler) and the kill switch
  `EMAIL_SENDING_PAUSED_UNTIL` isn't set; emails only go Mon–Fri 9–17 in the batch's country time.
