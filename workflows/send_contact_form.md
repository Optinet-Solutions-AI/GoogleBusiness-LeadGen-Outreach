# Send a lead's website contact form (AI fills it in and sends it)

**Owner code:** `web/lib/contact-form/{rules,runs}.ts`, `web/lib/services/contact-form-browser.ts`,
`app/api/leads/[id]/contact-form/route.ts`, `components/outreach/ContactFormModal.tsx`, Cloud Run `MODE=contact-form`.
Migration **065** (`contact_form_runs`). Design: `docs/superpowers/specs/2026-11-20-contact-form-send-design.md`.

## When to use

The lead has a website (or a contact page) but no email we can use, or you'd rather reach them through their own
"Contact us" form. One lead at a time.

## Steps (lead page → Contact box → **Contact form**)

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

## What the result means

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
