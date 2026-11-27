# Score leads (OpenAI lead score)

Since 27 Nov 2026 · migration 076 · spec `docs/superpowers/specs/2026-11-27-lead-score-and-cost-per-reply-design.md`

## What the score means

A number from 0 to 100: **how likely this business is to reply and buy the offer we would pitch it** (website build,
redesign, AI services, buy inventory, booth build, reputation management; the lead's segment decides which).

| Band | Score | Read it as |
|---|---|---|
| **Hot** | 70–100 | Very promising: contact first |
| **Warm** | 40–69 | Worth a try |
| **Cold** | 0–39 | Unlikely |

Each score has **2–3 reasons** and **what's holding it back** (e.g. "No email found").

The score **only orders leads**. It never skips, blocks or contacts a lead by itself: the usual rules (segment,
suppression, Test mode, verification) still decide what may be sent.

## What the AI sees

Facts we already have, nothing else (no web search):

- business name, type, place, Google rating and review count;
- segment and the offer we'd pitch;
- the AI website check (verdict, score, reasons) or "not checked";
- the AI Lookup summary;
- for closure / exhibitor / review-site leads, the notice, show or platform rating;
- contact readiness as yes/no facts: email (own and checked / own not checked / head office only / bad / none),
  phone yes/no, contact form page yes/no, owner's name known yes/no.

It **never sees an email address or a phone number**.

## When it runs

1. **During scraping:** the last step for each lead AI Lookup runs on, after the website check and AI Lookup. Up to
   `LEAD_SCORE_MAX_PER_BATCH` leads (default 100), about **half a cent a lead**, shown in the batch estimate as
   "Lead score". A batch with AI Lookup unticked gets no scores. If OpenAI is down, scraping carries on without scores.
2. **Score again** on the lead page's **Lead score** box: one call, a few seconds. It waits 2 minutes after the last
   score so you don't pay twice.
3. **Score this batch** on a finished batch's page (for batches made before 27 Nov or with scores missing): it shows
   "Score N leads, about $X" first. Nothing is spent until you confirm. It runs on the Cloud Run worker
   (`MODE=lead-score BATCH_ID`), 4 at a time. Refresh the page after a few minutes.

## Where you see it

- **Leads list:** the **Score** column. Click its header to sort; unscored leads ("—") sort last. Hover a score for
  its reasons.
- **Batch page:** the same column in the leads table.
- **Lead page:** the **Lead score** box.
- **The Brain:** each lead's score goes into what the AI reads. The plan lists high scores first.
- **Batch email** ("Email this batch"): when the daily limit decides who goes first, high scores go first.

## Settings

| Env | Default | Meaning |
|---|---|---|
| `OPENAI_SCORE_MODEL` | `gpt-5.4-mini` | The model. Priced with `OPENAI_CONTACT_USD_PER_MTOK_IN/_OUT` |
| `LEAD_SCORE_MAX_PER_BATCH` | 100 | Most leads scored per scrape batch or per "Score this batch" run (0 = off) |

Uses `OPENAI_API_KEY`: on Cloud Run (scraping, Score this batch) and on Vercel (Score again).

## If something's wrong

| You see | Do |
|---|---|
| "Run database update 076 first" | Run `db/migrations/076_lead_score.sql` in Supabase |
| "Lead scoring isn't switched on" | `OPENAI_API_KEY` is missing (ask the admin) |
| "This lead was just scored…" | Wait the seconds it says |
| A score looks wrong | Read its reasons. If a fact is wrong (e.g. the website check), fix that first (Check website again / AI Lookup), then Score again |
