# Email Outreach Playbook — RateUp Local Lead-Gen Pipeline

> End-to-end reference for THIS project's outreach: scrape a city+niche from Google Maps →
> build a personalized demo site per lead → screenshot it → run a screenshot-first email
> sequence (or a list campaign) within caps and the prospect's timezone → triage replies →
> close. Adapted from the generic cold-email playbook, but grounded in this codebase.
>
> What makes us different from a plain cold-email tool: **the offer is a real, personalized
> demo website we built for them, and the email leads with a screenshot of it.** The asset
> being sold is matched to the lead's website segment, not a one-size pitch.

The loop:

```
Niche + City → Scrape (Google Maps) → Review leads → Build demo site
   (enrich → generate → deploy → screenshot) → Verify email → Enroll in the
   screenshot-first sequence (or a Campaign) → Send (rotated senders, in the
   prospect's timezone, auto-translated, within warmup caps) → Replies (IMAP)
   → Post-reply workflow (meeting → improve → handover → close) → Status report
```

Two rules sit above everything (same as the generic playbook):

1. **Real data only.** Every lead, email, screenshot, reply, and number comes from the live
   system. Never invent a lead, guess an email, fabricate a "personal" detail, or report a
   metric you didn't pull. Copy personalizes only from real fields (`business_name`,
   `category`, `rating`, the real demo screenshot) — never an invented hook.
2. **Reputation is the whole asset.** Cold email works only while the sending mailboxes stay
   trusted. Over caps, mailing unverified/invalid addresses, broken SPF/DMARC, or sloppy copy
   push you to spam, and recovery is slow-to-impossible. When in doubt, deliverability over volume.

**Go through the pipeline, not around it.** State lives on the `leads` row and is advanced by the
atomic pipeline stages and the API (`web/app/api/...`) — dedup, verification gating, warmup caps,
sender rotation, suppression, and the audit trail all live there. Don't hand-edit the DB to "fix"
state, and don't call a scraper/sender out of band. Long work (scrape, build, screenshot, the
sequence tick) runs on the **Cloud Run job** (`MODE=…`), never in a Vercel route (60s cap). Every
API response is `{ success: true, data }` or `{ success: false, error }`.

---

## Stage 0 — Pre-flight (start of every session)

- **App reachable?** `GET /api/health`. Dashboard is Next.js on Vercel; long jobs on Cloud Run
  (`lead-batch-runner`, project `pearl-view-491114`).
- **Is sending paused?** `EMAIL_SENDING_PAUSED_UNTIL` — ISO kill switch; if in the future, ALL
  sends are intentionally halted. Don't route around it.
- **Sender health.** `GET /api/email-accounts` — for each connected mailbox note status, warmup
  state, and today's sent vs its (warmup-ramped) cap. A mailbox mid-warmup or capped is not safe
  for volume.
- **Migrations applied?** Latest schema migration is in `db/migrations/` (e.g. `037` added
  `call_campaigns.sender_emails` for multi-sender rotation). Apply pending ones in Supabase first.

---

## Stage 1 — Scrape (Google Maps → leads)

Operator picks **niche + city + scraper** and runs a batch. Only **Stage 1 (scrape)** auto-runs
across a batch; everything after is per-lead and operator-triggered.

| Scraper | Default? | Per-query cap | Notes |
|---------|----------|---------------|-------|
| **Apify** (Google-Maps actor) | yes | 300 | ~$2–4/1k; returns info + website-crawled emails/socials in one pass. |
| **Google Places** (Text Search Pro) | no | 60 | $35/1k; $200/mo free credit. ToS: cache phone/address/reviews ≤30 days. |
| **Outscraper** | no | 500 | ~$3/1k; batch, don't loop one-at-a-time. |

`POST /api/batches { niche, city, scraper, limit }` creates the batch + a cost estimate
(`lib/pricing.ts`), then the Cloud Run job (`MODE=batch`) scrapes → leads land at `stage='scraped'`
for review. Pull live cost before committing: `GET /api/pricing/estimate?scraper=&limit=` /
`/api/pricing/compare`.

**Never burn a paid scraper without confirmation.** If a stage fails, fix and ask before re-running.

---

## Stage 2 — Segment the leads (who gets WHAT offer)

The classifier audits each lead's existing web presence and routes the offer. **This is the core
decision — we never pitch a website to a business that already has a good one.**

| Segment | Signal | Offer |
|---------|--------|-------|
| **no_website** | no real owned site (none / social / parked) | **Build** a demo website |
| **old_website** | real but weak/dated (`needs_improvement`) | **Improve** — pitch a modern rebuild demo |
| **has_website** | real + healthy site | **AI services** (AI receptionist / booking) — NOT a website |

Derivation is centralized in `resolveSegment` (operator override wins, else derived from website
signals) — used identically by the dashboard, badges, and the send scheduler so every surface
agrees. The operator can override per lead (the segment dropdown locks it and stamps a "reviewed"
mark that survives clearing the lock). ⚠️ Known gap: parked domains (HugeDomains/Sedo) are caught by
the logo pipeline but not yet by the website classifier, so a parked lead can read as `has_website`
until manually flipped.

---

## Stage 3 — Build the demo site (the offer)

For a **no_website / old_website** lead in a focus niche, build the personalized demo:
`POST /api/leads/:id/build` → Cloud Run runs stages **2→3→4→4b**:

- **stage-2-enrich** — brand color, logo (real → monogram fallback; white backgrounds removed;
  parked/parking-service logos rejected), website audit, email lookup.
- **stage-3-generate** — niche single-file HTML template (token-swap) + Gemini copy. **Real photos
  only** (no reused stock); copy is written for the business's exact category, no em dashes.
- **stage-4-deploy** — Cloudflare Pages → `demo_url` on `<slug>.pages.dev`.
- **stage-4b-screenshot** — Playwright shot of the live demo → Supabase Storage (the screenshot the
  email leads with). Chromium only exists on Cloud Run.

Five focus niches build via single-file HTML (Trades, Dental, Chiropractic, Restaurant, Auto), each
with 3 selectable designs (preview link in the picker). Off-niche leads stay scraped/enriched and
usable for outreach but get no demo. Buildability tolerates legacy batch slugs by deriving the
template from the lead's category. **has_website leads are NOT built** — they go to AI services.

---

## Stage 4 — Verify the email (before first contact)

Bounces wreck mailboxes, so verify before mailing. Multi-verifier waterfall (`POST /api/verify`,
batch `/api/verify/sync`, or Cloud Run `MODE=verify`):

1. **ZeroBounce** (primary)
2. **Hunter** (second opinion — e.g. on a catch-all)

(`MillionVerifier` is omitted — account overdrawn.) `verification_status` ∈
`valid / catch-all / invalid / unknown`. **Sending is gated to `valid` and `catch-all` only**;
`invalid`/`unknown` never send. Never relax the gate to pad a list.

---

## Stage 5 — Outreach: the screenshot-first sequence (default) or a Campaign

Two ways to send; both run on the same engine (`lib/pipeline/sequence-scheduler.ts`, Cloud Run
`MODE=sequence`, Cloud Scheduler ~every 15 min). Replies/bounces/unsubscribes stop the ladder.

### A) Per-lead sequence (the screenshot-first ladder)
Enroll one built lead: `POST /api/leads/:id/sequence { action: 'enroll' }`. The 4-step
progressive-trust ladder, **4 days apart**:

| Step | Day | Content |
|------|-----|---------|
| 1 | 0 | plain text, no image/link |
| 2 | 4 | + inline demo **screenshot** |
| 3 | 8 | + live demo **link** |
| 4 | 12 | short break-up close |

Three copy variants by segment: **build** (no_website, 4 steps), **improve** (old_website, 4 steps),
**services** (has_website → AI receptionist/booking, **no demo/screenshot/link, 2 steps only**).
Enrolling a services lead needs only a verified email (no demo). Copy auto-translates to the lead's
language at send time and runs through a spam-risk gate; per-business spintax keeps no two identical.

### B) List campaign (multi-lead)
Build a campaign in the wizard (source → audience → timing → review): pick country (dropdown),
category (dropdown), segment, **multiple sender mailboxes**, and a day/hour send window. Creating an
email campaign enrolls its members into the same sequence engine.
`POST /api/campaigns`, attach leads `POST /api/campaigns/:id/leads`, mandatory test send
`POST /api/campaigns/:id/test-send`, then `POST /api/campaigns/:id/launch`.

### The send engine (what the scheduler guarantees)
- **Multi-sender rotation, pinned follow-ups.** A campaign holds a mailbox pool (`sender_emails`).
  At a lead's FIRST send the engine picks a mailbox by cap-aware rotation and **pins it**
  (`seq_sender_email`); every follow-up reuses that same mailbox — a business never hears from two
  addresses.
- **Per-mailbox warmup caps.** Each mailbox sends up to its own ramped daily cap (counted from the
  last 24h of its own sends); rotation skips capped mailboxes and defers when none have room.
- **Timezone-aware, randomized windows.** Sends land only inside the campaign's days/hours **in the
  prospect's country timezone** (47 countries mapped), with randomized jitter so there's no botted
  rhythm; out-of-window sends roll to the next valid slot.
- **Country-driven translation.** The selected country resolves to a language; per-lead detected
  language (from reviews) wins when present, else the country language, else English.

---

## Stage 6 — Sender mailboxes & caps

Mailboxes are **rows in `email_accounts`** (Bluehost/Titan SMTP+IMAP), connected/removed in the
dashboard — NOT env vars. `GET/POST /api/email-accounts`, `/bluehost` (connect), `/test` (verify
creds), `/:id` (remove).

- **Warm-up.** A new mailbox needs ~2–3 weeks: caps ramp automatically from low toward the target.
  **Always read the live cap; never assume a constant.**
- **Per-mailbox, not global.** The engine counts and caps each mailbox independently.
- **Raising a cap is an operator decision** — only when a mailbox consistently hits cap with healthy
  deliverability (low bounces, replies, clean DNS) and has ramped long enough.
- **Deliverability prerequisites:** MX/SPF/DMARC on the sending domain; fix red DNS before volume.

---

## Stage 7 — Test before live (mandatory)

`POST /api/campaigns/:id/test-send { testEmail }` renders the real template with a real lead's data
and sends one copy. Read it as a prospect on a phone: every token filled, the screenshot/link is
right (build/improve), spintax reads naturally, translation correct, no em dashes, looks good. **A
live send without a passing test is the one thing you never do.** A new/rewritten template going in
front of prospects is operator-approved.

---

## Stage 8 — Go live (gated)

The **first live send of any campaign** is an operator decision: present the plan (who, how many,
which mailboxes, window, caps respected), get the green light, then `POST /api/campaigns/:id/launch`
(or enroll leads into the sequence). Approval for one campaign is not standing approval for the next.
The scheduler then paces sends within caps + window; you set it up correctly, the engine drips it.

---

## Stage 9 — Monitor (live, never from memory)

- `GET /api/campaigns/:id/metrics` — sent / replied / bounced + rates.
- `GET /api/batches/:id/metrics` and `/export` — batch funnel + phone-reachable CSV.
- `GET /api/email-accounts` — authoritative live caps + status.
- A **rising bounce rate is a deliverability emergency** — pause (`EMAIL_SENDING_PAUSED_UNTIL`) and
  report, don't push through.

---

## Stage 10 — The inbox: triage replies

Pull inbound: `POST /api/email/sync` (IMAP across connected mailboxes). A human reply, an
unsubscribe, or a **bounce** all **STOP the sequence** — we never follow up a bad/blocked address.
Auto-replies/OOO/helpdesk acks are detected and don't count as real replies (`auto-reply-detector`).

The **inbox is grouped by campaign** (not by sender — sender is irrelevant to triage), newest
campaigns first, "Unassigned" last. For each human reply, read the thread for intent:

- **Hot** (wants to talk) → move toward a meeting.
- **Warm** (open) → thoughtful follow-up.
- **No / not a fit** → mark closed-lost; never re-contact (a clean no protects the domain).
- **Unsubscribe / hostile** → honor immediately; stop all contact with that address.

When reporting reply numbers, count real human replies, not auto-replies.

---

## Stage 11 — Post-reply workflow (close the deal)

`leads.stage`: `replied → meeting_booked → meeting_done → improved → handed_over →
closed_won / closed_lost / dead`.

- `POST /api/leads/:id/meeting { status: booked|done }` — record the call + notes.
- `POST /api/leads/:id/improve` — rebuild the demo with the customer's real photos/copy/hours.
- `POST /api/leads/:id/handover` — attach their custom domain (`mode: attach`) or record a transfer.
- Charge setup + monthly hosting on close.

---

## When to act autonomously vs. stop and ask

Act through the safe, reversible parts — scraping (within confirmed cost), reviewing/segmenting,
building demos, verifying, drafting/scheduling, running the test send, triaging replies, reporting.
**Stop for a green light** at the irreversible / outward-facing / cost moments:

- The **first live send** of any campaign (test passing).
- **Burning a paid scraper** (Apify/Places/Outscraper) or any paid API beyond a tiny check.
- **Raising a mailbox cap** or changing warmup.
- A **new/rewritten template** in front of prospects.
- **Resuming sending** while the pause switch is set.
- Mailing any address not confidently `valid`/`catch-all`, or any action you can't cleanly undo.

Lead with a one-or-two-line recommendation, not a wall of options.

---

## API quick reference (real routes)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | Liveness |
| `/api/batches` | GET/POST | List / create+queue a scrape batch (returns cost preview) |
| `/api/batches/:id` · `/run` · `/metrics` · `/export` | GET/POST | Detail / re-run / funnel / CSV |
| `/api/pricing/estimate` · `/compare` | GET | Cost preview (no paid calls) |
| `/api/leads` · `/count` · `/ids` · `/import` | GET/POST | Filterable leads / counts / id list / CSV import |
| `/api/leads/:id` | GET/PATCH | Inspect / hand-edit (segment, email, notes, …) |
| `/api/leads/:id/build` · `/regenerate` · `/improve` | POST | Build / re-run from stage / improve with real content |
| `/api/leads/:id/sequence` | POST | `{ action: enroll \| stop \| recapture }` |
| `/api/leads/:id/email` · `/outreach` · `/dm` · `/sms` | POST | Single send / outreach / social DM / SMS (dormant) |
| `/api/leads/:id/meeting` · `/handover` · `/reply` | POST | Meeting / domain handover / in-thread reply |
| `/api/verify` · `/verify/sync` | POST | Email verification (ZeroBounce → Hunter) |
| `/api/email/sync` | POST | Pull IMAP replies/bounces; stops sequences |
| `/api/email-accounts` · `/bluehost` · `/test` · `/:id` | GET/POST/DELETE | List / connect / test / remove a mailbox |
| `/api/campaigns` · `/:id` · `/leads` · `/test-send` · `/launch` · `/metrics` | GET/POST | Build, attach, test, launch, monitor |
| `/api/sites/:lead_id` | GET | Demo URL + deploy status |
| `/api/social-accounts` | GET/POST | Social presence records |

Cloud Run job modes (`MODE=…` on `lead-batch-runner`): `batch`, `queue`, `verify`, `build`,
`improve`, `regenerate`, `screenshot`, `sequence`.

Env switches that change sending: `EMAIL_SENDING_PAUSED_UNTIL` (kill switch). Mailboxes + their caps
live in `email_accounts`, not env.

---

## Things you never do

- Hand-edit the DB to "fix" lead/campaign state, or call a scraper/sender out of band.
- Send to `invalid`/`unknown`, or relax the verification gate to grow a list.
- Exceed a mailbox's live cap, or change caps without operator approval.
- Send without a passing test, or run the first live send of a campaign unapproved.
- Pitch a **website to a has_website lead** (offer AI services instead).
- Switch a business's sender mid-thread (follow-ups stay on the pinned mailbox).
- Run long work in a Vercel route (use the Cloud Run job).
- Invent a lead, guess an email, fabricate a "personal" detail, or report a count you didn't pull.
