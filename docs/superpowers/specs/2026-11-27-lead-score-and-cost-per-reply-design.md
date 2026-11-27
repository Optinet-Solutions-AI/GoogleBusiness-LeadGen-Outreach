# Lead score (OpenAI) + cost per reply by segment — design

Date: 27 Nov 2026 · Source: competitor research, Part IV ideas 3 + 4
(`docs/superpowers/research/2026-11-26-client-acquisition-platforms.md`) · Project 1 of 3 (then mailbox auto-pause,
then AI reply handling).

## Why

- **Lead score:** the operator (and the Brain) should work the best leads first instead of treating 100 leads the
  same. Competitors (Part III's 89/100 example, Maplo, LeadSwift) score each prospect from evidence. We already
  collect the evidence (website check, AI Lookup, rating, reviews, signals); nothing turns it into one number.
- **Cost per reply by segment:** tells us where to scale. Explee judges every segment by cost per lead; we record
  sends, replies and most of the spend, but never put them side by side per niche / city / offer.

Success: on the Leads list the operator sorts by score and the top rows are visibly the better prospects, each with a
reason they can read; the Analytics page shows, per niche / city / offer, how much a reply cost.

## Goals

1. Every qualified lead gets an **OpenAI lead score** 0–100 during scraping, with 2–3 short reasons tied to facts we
   have, and the one thing holding it back.
2. The score shows on the Leads list (sortable column), the batch page's lead table, and the lead page.
3. The Brain sees the score and works high scores first.
4. A **"Cost per reply"** section on `/analytics`: rows per niche, city or offer.

## Non-goals

- The score never blocks, skips or contacts a lead by itself. It orders and informs; the existing rules (segment,
  offers, suppression, test mode, verification) decide what may happen.
- No exact billing. Cost per reply uses what we record (estimates + recorded real costs), labelled as such.
- No interested-vs-not reply split (that needs project 3, AI reply handling). "Reply" = a human email reply.
- No automatic re-scoring when facts change (costs money); the operator presses "Score again".

## Anti-goals (would be a failure even if it works)

- The AI inventing facts: a reason that isn't backed by an input we sent ("they have 3 locations" when we never said
  so). Reasons must come from the facts given; the prompt says so and the AI gets no web search.
- Spending money the operator didn't see: scoring is in the batch estimate, capped per batch, and scoring old leads
  shows its cost before it runs.
- Sending private contact data to the AI: like the Brain, the AI sees whether an email / phone / contact form exists
  and how good it is, never the address or number itself.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | Its own OpenAI call per lead after AI Lookup and the website check | Every lead scored with the full picture; ~0.5–1¢ a lead, capped and in the estimate |
| B | Add a score to the AI website check | Free, but sees only the website, and leads with no website get no check, so no score |
| C | The Brain scores while it judges | Free, but only leads inside a Brain job get a score |

Operator picked **A** (27 Nov 2026): "let's use open ai to identify lead score" → A.

## Part 1 — Lead score

### What the score means

How likely this business is to **reply and buy the offer we would pitch it** (the lead's resolved offer: website build,
redesign, AI services, buy inventory, booth build, reputation management). Bands (my call): **Hot 70–100**,
**Warm 40–69**, **Cold 0–39**.

### What the AI is given (facts only)

Business name, category, city / country, Google rating + review count, segment and offer, website check (verdict,
score, reasons, booking / platform found, pitch why), AI Lookup summary, signal details for closure / exhibitor /
review-site leads (date, show, platform rating), and contact readiness as plain facts: has an email (own domain or
head office, verified / likely / unchecked), has a phone, has a contact form page, owner name known (yes/no). Never the
email address or phone number.

### What it returns (strict JSON schema)

`{ score: 0–100, band, reasons: string[2..3], holding_back: string }`. Stored with the model, cost (usd), and when.

### When it runs

- **Which leads:** the same leads AI Lookup runs on (qualified leads of every kind, including closure / exhibitor /
  review-site leads); its own cap, not shared with AI Lookup's; over the cap, the first N in scrape order (like the
  website check). (my call)
- **During scraping**, as the last per-lead step of stage 1, after AI Lookup and the website check for that lead.
  Budget env `LEAD_SCORE_MAX_PER_BATCH` (default 100, 0 = off), model env `OPENAI_SCORE_MODEL` (default
  `gpt-5.4-mini`, priced with the `OPENAI_CONTACT_USD_PER_MTOK_*` rates). Added as a line to the batch estimate.
  OpenAI unavailable → skipped, the batch gets a notice like AI Lookup's (`batches.notices`).
- **Score again** on the lead page: one call, run straight from the route (no browsing, short), refused within 2
  minutes of the last score (429, nothing paid), like AI Lookup.
- **Score this batch** on a finished batch's page for leads without a score (older batches): shows "N leads, about
  $X" and runs only after the operator confirms, on the Cloud Run job (new `MODE=lead-score`), same cap.

### Where it shows

- Leads list: a **Score** column (number + band colour), sortable, hover shows the reasons and what's holding it back.
  Unscored leads show "—" and sort last. The sort runs in the database query (nulls last), not on one loaded page.
  (my call)
- Batch page lead table: the same column.
- Lead page: a small "Lead score" box (score, band, reasons, holding back, when, Score again).
- The Brain: the score and band go into each lead's facts (`lib/brain/judge.ts`); the plan lists leads highest score
  first; where a daily limit decides who goes first (Brain approve / batch email), highest score first. Unscored leads
  come after scored ones; the Brain never refuses or warns because of missing scores (it still judges them). (my call)

### Storage (migration 076)

`leads.lead_score int` (sortable, indexed), `leads.lead_score_detail jsonb` (band, reasons, holding_back, model, usd,
scored_at), `leads.lead_scored_at timestamptz`. Code tolerates them missing (like 059–075).

## Part 2 — Cost per reply by segment

### Where

A **"Cost per reply"** section on `/analytics`: a table with a **Group by: Niche / City / Offer** switch and a
**30 days / 90 days / All** switch (the Templates page's Results uses the same ranges).

### Columns per row

Leads found · Leads contacted (got at least one email, contact form or AI call) · Emails sent · Replies · Reply rate
(replies / contacted) · Interested calls · Spend · **Cost per reply** (spend / replies; "—" with no replies).

### Definitions (my calls, stated so the operator can correct them)

- **Reply** = a human `email_reply` event (auto-replies, bounces, unsubscribes excluded), counted once per lead.
- **Interested call** = leads with a `call_qualified` event, counted once per lead, its own column (calls aren't
  replies).
- **Spend** per lead = the batch's `estimated_cost_usd` (there is no recorded real batch cost) split evenly over all
  the leads the batch saved, qualified or not, + real costs recorded on
  that lead later (contact form runs' `cost_usd`, the lead score and AI Lookup / website re-checks done after the
  batch). AI call minutes (Voizo) and email sending (Ongage) aren't recorded per lead, so they aren't included; the
  section says so in one line. The column header says "Spend (estimated)".
- **Time range** filters by when the batch was created (when the leads were found): a row covers those batches'
  leads, their whole spend, and every contact and reply they got, so leads never contacted still count as cost.
  Daily-scheduled, cancelled and partial batches count like any other; WARN / SEC batches are cheap because their
  estimate is mostly AI Lookup. (my call)
- **Test mode:** a send made while Test mode is on reaches a test address, not the business. From now on, every
  email / contact form / AI call event written while Test mode is on gets `meta.test_mode = true` (no migration), and
  this table ignores those events (no contact, no reply counted). Events before 26 Nov 2026 (075) were real. While
  Test mode stays on, the table will be mostly empty; that's expected and the section says so. (my call)
- Niche = the batch's niche ("Any …" batches use the lead's category); City = the batch's city; Offer = the lead's
  resolved offer.

### How

Pure module (grouping + maths, tested) + a loader that reads leads, batches, outreach_events, contact_form_runs (read
only, no migration) + the page section, + the `meta.test_mode` stamp at the send points that write events. Free to
open.

## Constraints

- Golden rules (CLAUDE.md): dumb client components, thin routes, logic in `lib/`, required file headers, zod at
  boundaries, external calls through `lib/services/`, retry + logging.
- Never run paid calls without the operator seeing the cost (Golden rule 7).
- Test mode stays on; nothing here sends anything.
- Workflow markdown first: `workflows/score_leads.md` (and a line in `run_brain_job.md`, `lib/assistant/knowledge.ts`,
  CLAUDE.md).

## Left to the builder

Prompt wording; exact token-based cost estimate; the colour of each band; how the Leads list sort is wired; table
layout on `/analytics`; how the Cloud Run `MODE=lead-score` batches its calls (sequential with a time budget like
the website check is fine).
