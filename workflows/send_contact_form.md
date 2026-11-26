# Send a lead's website contact form (AI fills it in and sends it)

**Owner code:** `web/lib/contact-form/{rules,runs}.ts`, `web/lib/services/contact-form-browser.ts`,
`app/api/leads/[id]/contact-form/route.ts`, `components/outreach/ContactFormModal.tsx`, Cloud Run `MODE=contact-form`.
Migration **065** (`contact_form_runs`). Design: `docs/superpowers/specs/2026-11-20-contact-form-send-design.md`.

## From Send email (25 Nov 2026, Meny)

Send email has **Send to: Email / Contact page / Both** when the lead has a contact page or website on its own site.
Contact page / Both start one worker run (`STEP=look_send`, `startLookThenSend` → `runLookThenSendStep`): it looks at
their form and, when it can be filled, sends the same subject + message once (same gates as below). Both sends the
email first, then starts the form. The result shows in the lead's Contact page window.

**A CAPTCHA after Send** (Wix: "Please confirm you're human") is recognised (page check, then the AI's `CAPTCHA`
reply) and the run is **blocked** with the send-it-yourself steps. Before this fix such runs showed "unknown": both
earlier "unknown" sends (Elsasser's, Moe's Kitchen) were this popup, so nothing went out.

## Testing safely

`/test-form` is a RateUp contact page with no CAPTCHA (migration **071**, `test_form_messages`); messages show on
`/test-form-received`. Set a test lead's website to the app's address (it counts as a real website) and its contact
page to `/test-form`, then use Contact page or Send email → Contact page. Never test on a real business's form.

## When to use

The lead has a website (or a contact page) but no email we can use, or you'd rather reach them through their own
"Contact us" form. One lead at a time.

## Steps (lead page → Contact box → **Contact page**)

(One button since 24 Nov 2026: the old separate "Contact form" and "Contact page" buttons were merged. The window
links to their contact page too. A contact page that isn't on the lead's own site is just a link.)

1. **Look (free, ~1 min).** The worker opens their contact page and shows a screenshot of the form. If their
   contact page is on another site (Facebook, a directory) it's ignored and their own homepage is searched instead.
   - "No contact form found" → nothing to send; use email or a call.
   - "CAPTCHA / bot check" → we never get around it; nothing is sent.
   - A screenshot from the last 24 hours is reused; **Look again** takes a new one.
2. **Write it.** Pick the mailbox (its name and address go in the form; the reply comes to that inbox), pick what
   you're offering (ready-made or a saved template), edit subject and message, Regenerate if you like.
3. **Send via their form (paid, about the cost shown, ~1–2 min).** AI fills the form with exactly that — phone and
   anything we don't truly know stay empty — and clicks Send **once**. You then see the filled form and their page
   after sending.

## Progress outside the window, Cancel, the success screenshot (26 Nov 2026)

- **Progress**: the lead page's Contact box shows a "Contact form" line (`ContactFormStatus`, polls the free GET every
  5 s while AI works) and the Leads list shows a mark under Reach out (`lib/leads/outreach-marks.ts`, the list re-reads
  itself every 8 s while a form is running).
- **Cancel** (`{action: "cancel"}` → `cancelRun`): looking / sending → `cancelled` in one conditional update
  (migration **073**; before it the attempt is recorded as `failed` with the same reason). The worker asks "was it
  cancelled?" before any paid step and again right before its one Send click; after the click nothing can stop it and
  a message that went out is recorded as **sent** even if Cancel was pressed (the truth wins). A cancelled look is
  never sent by look-then-send.
- **Success screenshot**: after the one click the worker waits for their page to confirm (its thank-you text, or a
  move to a thank-you page; up to ~30 s; words already on the page before Send don't count), scrolls the message
  into view and screenshots that. Still unclear → one more look after 6 s. Never a second click.

## What the result means

- **Cancelled** — you stopped it before AI pressed Send. Nothing was sent.

- **Sent** — their page confirmed it. Timeline shows "Contact form sent"; the lead moves to Contacted (outreached).
- **Couldn't send: <reason>** — their page showed an error (e.g. a required phone number). Nothing more is tried.
- **Blocked** — CAPTCHA, a required field we can't honestly fill, or AI safety stop. Nothing was sent.
- **May have been sent — check their page** — the send started but we couldn't confirm it (or the worker stopped).
  Open the screenshots / their page before trying again, so they don't get it twice.

## Rules

- Same blocks as email: the pause switch (`EMAIL_SENDING_PAUSED_UNTIL`) and unsubscribed / do-not-contact leads.
  No email-address check (we don't use their email). No country block (operator decision, 20 Nov 2026).
- Only ever submits on the lead's own website. Never makes up data. Never sends twice from one click.
- One attempt per lead at a time; one stuck for 10+ minutes stops counting as busy.

## When it fails

- "Run database update 065 first" → run `db/migrations/065_contact_form_runs.sql` in Supabase.
- "Contact forms need the Cloud Run worker" → only works on the live app, not local dev.
- "Couldn't start the worker" → Cloud Run trigger failed; try again, else check the GCP env vars in Vercel.
- AI errors (no credit / bad key) show in the OpenAI banner like AI Lookup. Model: `OPENAI_FORM_MODEL`.
