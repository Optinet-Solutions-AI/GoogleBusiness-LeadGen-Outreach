# Contact form send — design

Date: 20 Nov 2026 · Status: draft for operator approval

## Intent

Some leads can only be reached through the "Contact us" form on their website. The operator wants to reach them
there the same way they reach others by email: pick what we're offering, get a ready-made message, and send it.
AI fills in the form and submits it for real. One lead at a time, from the lead page.

The operator asked to **see the form first** (a screenshot when they open the contact form window) and to have the
form **sent straight away when they click Send** — no second review step after AI fills it. They see what was sent
afterwards (screenshots).

## Goals

- A **Contact form** button on the lead page (Contact card) opens a window that:
  1. opens the lead's contact page on the Cloud Run worker and shows a **screenshot of the form** (free, no AI);
  2. lets the operator pick the sender mailbox and the offer (same "What are you offering?" list + Saved templates
     as Send email), edit subject + message, see the cost, and click **Send via their form**;
  3. on Send: AI fills the form with that message and submits it, in one worker run; the window then shows a
     screenshot of the **filled form just before submit**, a screenshot of **their page after submit**, and
     "Sent" or "Couldn't send: <reason>".
- Every attempt is kept (who, when, which page, message, fields filled, screenshots, outcome, cost).
- A sent form shows on the CRM timeline / activity feed as "Contact form sent" and moves the lead to `outreached`
  when it's earlier in the pipeline (same rule as Send email).

## Non-goals

- No batch / bulk sending (one lead at a time for now).
- No follow-ups (a form has no thread). Replies arrive by email at the mailbox entered in the form.
- No "Refresh lead" button — separate piece of work, designed after this.
- The old dry-run script (`web/scripts/contact-form-dryrun.ts`) is not extended for batches; its core is moved into
  `lib/` and reused.

## Anti-goals (a failure even if it works)

- **Never bypass a CAPTCHA or bot check.** Seen one → stop, outcome `blocked`, say so.
- **Never invent data.** Only our sender name, sender email, subject and message go in. Phone and any field we
  have no true value for stay empty. A required field we can't honestly fill → stop, `blocked: <field>`.
- **Never submit more than once** per Send click (no retry of the submit step; a lost result is reported as
  "unknown — check their page", not re-sent).
- **Never send to a lead the email rules would refuse** for suppression: kill switch `EMAIL_SENDING_PAUSED_UNTIL`,
  unsubscribed / do-not-contact (`isSuppressed`). Email verification does NOT apply (no email address is used).
- **No country block** (operator decision, 20 Nov 2026): EU / EEA / UK leads may be sent, same as Send email
  (AI calls still block them; that rule is not reused here).
- Never submit on a page that isn't the lead's own site (same host as `website_url` / `contact_page_url`).

## Constraints

- Needs Chromium → runs on the **Cloud Run job** (`lead-batch-runner`, new `MODE=contact-form` with
  `LEAD_ID` + `RUN_ID`), never in a Vercel route (60 s cap). Each step takes ~1 min while the worker starts; the
  window shows a working state and polls.
- Paid: OpenAI computer-use per Send (the experiment used model `gpt-6.1-sol`, ~8–9 steps per form). The "look"
  step is free (Playwright only). Golden rule 7: the cost is shown before Send; Send is the confirmation.
- Project rules: thin routes (zod → `lib/`), `{ success, data | error }`, file headers, workflow markdown first
  (`workflows/send_contact_form.md`), migration file for the new table, code tolerates the migration missing
  (button explains "run migration 065").

## Approaches considered

1. **Cloud Run job per step (chosen).** "Look" run and "Send" run, each a short `MODE=contact-form` execution;
   state in a new table; the window polls. Same pattern as Build. Only option that fits the stack.
2. Playwright inside a Vercel route — impossible (no Chromium, 60 s cap).
3. A hosted browser service (Browserbase etc.) — new paid dependency and account, buys nothing here.

Operator picked: one lead at a time; message from the Send email offers + templates; send for real; screenshot of
the form when opening; submit straight away on Send (no review step after filling).

## Design

### Data — migration `065_contact_form_runs.sql`

Table `contact_form_runs`: `id`, `lead_id` (FK), `status` (`looking` · `ready` · `no_form` · `sending` · `sent` ·
`blocked` · `failed` · `unknown`), `contact_url`, `form_shot_url` (blank form), `filled_shot_url`,
`result_shot_url`, `sender_email`, `sender_name`, `subject`, `message`, `offer_key`, `fields` (jsonb
`[{name,value}]`), `reason` (plain words), `usd` (numeric), `created_at`, `updated_at`, `sent_at`.
Screenshots go to the existing public Storage bucket `lead-screenshots` under `contact-forms/<lead>/<run>-*.png`.

### Flow

- **Open window** → `POST /api/leads/:id/contact-form` `{action:"look"}` → refusals checked first (no website,
  suppressed) → row `looking` → trigger job. The job: find the contact page (`contact_page_url` if set and same
  host, else the homepage link finder from the experiment), load it, screenshot, detect whether a form exists
  (any visible `form` / `textarea` / email input, in any frame) and an obvious CAPTCHA → `ready` / `no_form` /
  `blocked`. If a recent `ready` run (< 24 h) exists, reuse it instead of starting a new look (free, instant);
  a "Look again" link forces a new one.
- **Compose** — same pieces as `SimpleEmailModal`: mailbox picker (default as in Send email, incl. OptiRate
  sender for review-site leads), offer list + saved templates, subject, message, Regenerate. The context comes
  from the existing compose context (`lib/email/compose-context.ts`). Reuse components rather than copy them.
- **Send** → `POST …/contact-form` `{action:"send", runId, senderEmail, subject, message, offerKey}` → gates
  (kill switch, suppression, run is `ready`, not already sent) → `sending` → trigger job. The job, one browser
  session:
  - Phase A — fill: the experiment's computer-use loop with the submit guard ON (submit clicks / Enter blocked,
    non-GET requests aborted). Sender name = the mailbox's display name, email = the mailbox address.
    Ends `FILLED`, `NO_FORM` or `BLOCKED:<reason>`; anything but FILLED → stop, no submit.
  - Screenshot → `filled_shot_url`; record the filled fields.
  - Phase B — submit: lift the network block, allow exactly **one** submit (AI told "click the send button now",
    or code clicks the submit control of the form that holds the filled fields — builder's choice), wait for the
    page to settle, screenshot → `result_shot_url`, ask the model one question about the result screenshot:
    sent / error shown / unclear → `sent` / `failed` (with the page's error) / `unknown`.
  - `pending_safety_checks` from OpenAI → stop before submit, `blocked`.
- **On `sent`:** `outreach_events` row `contact_form_sent` (meta: run id, contact_url, sender, offer, screenshots,
  usd), CRM timeline label "Contact form sent", activity-feed verb "contact form sent", stage → `outreached` when
  earlier (reuse the Send email rule). `blocked` / `failed` write `contact_form_blocked` / `contact_form_failed`
  (no stage change).
- **Polling:** `GET /api/leads/:id/contact-form` returns the latest run; the window polls every few seconds while
  `looking` / `sending` and gives up after ~5 min with "still working — check back".

### Screens (Contact card → "Contact form")

```
1. "Opening their contact page…"           → screenshot of the form + "Open page" link
   (no form / CAPTCHA → says so and stops)
2. From [mailbox ▾]  Offering [Ready-made ▾ / Saved ▾]  Subject  Message  [Regenerate]
   Cost: about N¢                          [ Send via their form ]
3. "Filling and sending…"                  → filled-form screenshot, after-send screenshot,
                                             "Sent ✓" / "Couldn't send: <reason>" / "Not sure — check their page"
```

The existing "Contact page" link stays (opens their page in a new tab).

## Calls I made (operator may correct)

- Sender name/email in the form = the mailbox picked (replies land in our IMAP inbox); phone left empty.
- Same suppression + kill switch as email; no email verification gate.
- Sent form → stage `outreached`; event name `contact_form_sent`.
- No follow-ups.
- Reuse a "look" screenshot for 24 h.
- Model and price come from env (`OPENAI_FORM_MODEL`, default the experiment's `gpt-6.1-sol`;
  `OPENAI_FORM_USD_ESTIMATE` shown before Send); the real cost of each run is computed from OpenAI's reported
  usage and saved on the run.

## Answers from the builder check

- **Is the computer-use loop proven?** Yes, as a dry run: on 27 Oct 2026 the script ran one batch with
  `gpt-6.1-sol` — 24 forms filled, 2 blocked (a Cloudflare CAPTCHA, a network-error popup), ~8–9 steps each.
  It already stops on `pending_safety_checks`. It has never submitted, so phase B is new. `OPENAI_API_KEY` is
  already on Cloud Run (AI Lookup runs there during scraping). If the model is gone, the run fails with a clear
  reason; `OPENAI_FORM_MODEL` switches it.
- **Phase A network block** (my call): keep it — it's what the proven dry run did. A form that can't be filled
  with it on is `blocked`, which is acceptable. **Phase B** (my call): the AI clicks the send button (one allowed
  click, guard lifted for that click only), because it already handles embedded forms (HubSpot, Typeform iframes)
  and pages with several buttons; code then blocks any further submit.
- **Which leads** (my call): the button shows on every lead that has a `website_url` or `contact_page_url`, any
  segment (closure, exhibitor, review-site included). The offer list defaults by segment, as in Send email.
- **Sender name** (my call): the mailbox's `from_name`; if empty, the address's local part capitalised
  ("grace" → "Grace"). A form send does **not** count toward the mailbox's daily cap (it doesn't go through
  Ongage); no extra daily cap (one manual send at a time, like Send email).
- **Cost** (my call): per-token prices from env (`OPENAI_FORM_USD_PER_MTOK_IN` / `_OUT`, defaults set to the
  model's list price when built); the saved `usd` is computed from OpenAI's reported usage. No budget cap beyond
  the shown estimate; an OpenAI failure updates `service_health` like AI Lookup.
- **Double clicks / dead runs** (my call): one active run per lead — a new look/send is refused while a run is
  `looking` / `sending` and less than 10 minutes old; older ones are shown and treated as `failed` ("the worker
  stopped — try again"). No sweeper job.
- **Screenshots** (my call): the existing public `lead-screenshots` bucket, under unguessable run-id paths. They
  show their public page and our own message, nothing private. (The dashboard itself has no login yet.)

## Left to the builder

- How exactly the single submit is done in phase B (AI click vs code click), as long as it's exactly one.
- Form / CAPTCHA detection heuristics for the look step.
- Component reuse vs extraction from `SimpleEmailModal`.
- Poll interval and timeouts.
