# Manage email templates (saved, versioned) + Regenerate + the demo-link switch

**Owner code:** `web/lib/email/template-library.ts` (DB + versions), `web/lib/email/template-render.ts` (placeholders,
pure), `web/lib/email/regenerate-copy.ts` (+ `rewriteOutreachEmail` in `lib/services/gemini.ts`), page
`/email-templates`, `components/outreach/SimpleEmailModal.tsx`. Migration **064**. Design:
`docs/superpowers/specs/2026-11-19-templates-and-voice-agents-design.md`.

## Templates page (Outreach → Templates)

- **New template:** name, the offer it's for (or any), subject, email, up to two follow-ups.
- **Placeholders**, filled for each lead: `{{business}} {{first_name}} {{city}} {{category}} {{demo_link}} {{site}}
  {{rating}} {{reviews}} {{event}} {{booth}} {{sender}}`. A line with only an empty placeholder (e.g. `{{demo_link}}`
  for a lead without a demo) is left out. A misspelt placeholder shows a warning and is never filled.
- **Edit = new version.** Every save keeps the old one. **History** lists all versions with date; **Restore** brings
  an old one back as the newest version, so nothing is ever lost.
- **Delete** hides a template (it's archived in the database, never removed): "Show deleted" + **Bring back** restores
  it. Send email also has **Delete this template** for the saved template that's picked (Meny, 25 Nov 2026).

## In Send email

- "What are you offering?" shows **Ready-made** (built in, can't be broken) and **Saved templates**.
- **Save as template** saves what's in the window; this lead's name, city, link etc. are turned back into placeholders.
- **Regenerate** rewrites the email (and follow-ups) with Gemini, free tier: same offer, facts, names, links and
  language. A rewrite that drops a link or uses spam words (free, guarantee…) is refused; press again.
- **Include the demo website link** (website / redesign emails, when the lead has a demo): untick to send without it.
- Follow-ups (24 Nov 2026): a switch in Send email, **off by default**; a saved template's follow-ups fill the boxes
  but are only scheduled when the operator switches follow-ups on. They are sent by the `email-sequence-tick`
  scheduler (Cloud Scheduler), which must be running.

## Results: which emails get replies (24 Nov 2026)

Top of the Templates page. One row per email used: the ready-made email ("SEO (show up higher on Google)"), a saved
template (name + version), a classic-sequence step or a follow-up. Columns: Sent · Replies · Reply rate · Edited
(changed before sending, still counted for that email; operator decision 24 Nov 2026) · Unsubscribed (incl. spam
complaints) · Bounced. Last 30 / 90 days / all time.

- A reply, unsubscribe or bounce counts for the **last email sent to that lead before it**; two replies count once;
  auto-replies never count; a send that didn't really go out (no mailbox) isn't counted.
- Sends from before 24 Nov 2026 weren't labelled: they show as one row, **Before tracking**.
- Under ~50 sends an email's reply rate swings a lot: read it as a hint, not a verdict.
- Owner code: `lib/email/email-results.ts` (pure rules), `email-events.ts` (reads, paged), `email-results-load.ts`,
  `email-used.ts` (what a send records in `outreach_events.meta.email_used`), `GET /api/email-results?days=`.

## Wording tests (24 Nov 2026, migration 066)

Two versions of one offer's email, to see which gets more replies.

1. Write version B as a saved template (New template, set its offer).
2. Results → **Start a wording test**: pick the offer, version A (the ready-made email or a saved template, i.e. what
   is used now) and version B.
3. While it runs, Send email for that offer fills **whichever version has fewer sends** (half and half) and says
   "Wording test: version A/B". The operator can still edit (it still counts, as edited).
4. The test shows A against B. Until each has **30 sends** it says "not enough sends yet".
5. **Keep A** / **Keep B** ends it (operator decision: no automatic winner). If the kept version is a saved template,
   Send email starts that offer with it from then on.

One test per offer at a time. Picking a different email in the window takes that send out of the test.
Owner code: `lib/email/wording-test.ts` (pure), `lib/email/email-tests.ts`, `/api/email-tests` (+ `/:id`),
`components/templates/EmailResults.tsx`.

## When it fails

- "needs database update 064" → run `db/migrations/064_templates_agents.sql` in Supabase.
- "Wording tests need database update 066" → run `db/migrations/066_email_tests.sql` in Supabase.
- Regenerate says Gemini is unavailable → `GOOGLE_GENAI_API_KEY` missing in Vercel, or try again in a minute.
