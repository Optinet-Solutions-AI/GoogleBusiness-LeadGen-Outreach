# CLAUDE.md — Local Lead-Gen & Auto-Site Pipeline

> Source of truth for this project. Loaded into every Claude Code session.
> Keep concise. Update when reality drifts.

---

## Project Overview

End-to-end pipeline that turns a city + niche into paying website-hosting clients.
Scrape Google Maps for local businesses **without (or with a weak) website**, auto-generate a personalized demo site for each, deploy it to a unique subdomain, capture a screenshot of it, and run a **screenshot-first cold-email sequence** (plain text → screenshot → link → soft close, 4 days apart). Charge a setup fee + monthly hosting on close. **Brand: RateUp** (rateupdigital.com).

**Business purpose:** Recurring revenue from local SMBs. Generation cost ~$0.05/site; close price hundreds-to-thousands.

- **Stack:** TypeScript + Next.js 14 (App Router) + Tailwind CSS — single app for frontend, API, and pipeline
- **Pipeline runtime:** Node 20+ (CLI script `web/scripts/run-batch.ts`)
- **Database:** Supabase (Postgres) — free tier
- **Site templates:** Astro + Tailwind (static HTML output, separate folder per niche)
- **Hosting / CDN:** Cloudflare Pages (one project per generated site, unlimited free)
- **External services:** Apify *or* Google Places API *or* Outscraper (scraping — toggleable per batch), **Google Gemini API** (site copy, free-tier), Cloudflare Pages (hosting), **connected SMTP mailboxes** (Bluehost/Titan — outbound email, managed in the dashboard `email_accounts`), email verification (ZeroBounce + Hunter), Mobivate (SMS — built but dormant), Stripe (billing — later). **Instantly.ai is deprecated** (kept only so historical webhook data still type-checks).
- **Default scraper:** `apify` (Google Maps scraper; safety cap 300/query). Alternatives: `google_places` (cap 60) and `outscraper` (cap 500).
- **Voice / phone calling:** REMOVED from this app — moved to a separate project. Some DB tables + `VAPI_*` config may remain but are inert here.

---

## How the App Works

```
1. Operator picks niche + city + scraper, clicks "Run batch"
   ↓
2. POST /api/batches → batch row + cost estimate. Cloud Run job (or CLI) runs
   STAGE 1 ONLY: scrape → leads land at stage='scraped' for operator review.
   ↓
3. Operator clicks "Build" on a lead → stages 2→4 (+4b) on the Cloud Run job
   (filesystem + minutes — too long for a Vercel Route Handler):
     stage-2-enrich      → brand color, logo, website audit, email lookup
     stage-3-generate    → niche template (single-file HTML token-swap / Astro) + Gemini copy
     stage-4-deploy      → Cloudflare Pages → demo_url on <slug>.pages.dev
     stage-4b-screenshot → Playwright shot of the live demo → Supabase Storage (public)
   ↓
4. Operator "Enrolls" a built lead → the screenshot-first EMAIL SEQUENCE:
     Day 0  plain text (no image/link)   Day 4  + inline screenshot
     Day 8  + live link                  Day 12 soft "take it down?" close
   Sent via connected SMTP mailboxes, verification-gated + warmup-capped. Driven by
   sequence-scheduler (Cloud Run MODE=sequence, Cloud Scheduler ~every 15 min).
   stage-6-sms (Mobivate one-time link) is the no-website/SMS path — built, dormant.
   ↓
5. Replies pulled via IMAP (POST /api/email/sync): a human reply, an unsubscribe,
   or a BOUNCE all STOP the sequence — we never follow up a bad/blocked address.
   ↓
6. Post-reply operator workflow:
     replied → meeting_booked → meeting_done
            → improve   (rebuild w/ customer's real photos + copy)
            → handover  (attach their custom domain to our Pages project)
            → closed_won  / closed_lost / dead
```

Each stage is **idempotent** — safe to re-run for any lead; status lives on the lead row.

Long work (scrape, build, screenshot, the sequence tick) runs on the **Cloud Run job** `lead-batch-runner` (`MODE=batch|queue|build|regenerate|improve|screenshot|sequence`), NOT in a Vercel Route Handler (60s cap). Stages 2–6 are **per-lead, operator-triggered** (the Build / Enroll buttons) — only stage-1 auto-runs across a batch. The HTTP `POST /api/batches/:id/run` exists for tiny ad-hoc re-runs, not production.

---

## Architecture

```
┌──────────────────────────────────────┐
│  Next.js App  (web/)                 │  one app, server + client
│                                      │
│  app/                                │
│   ├─ Operator dashboard pages        │  React server + client components
│   └─ api/  (Route Handlers)          │  thin: validate → call lib/
│                                      │
│  lib/                                │
│   ├─ services/  (external APIs)      │  one file per provider
│   ├─ pipeline/  (atomic stages +     │  the brain
│   │              sequence scheduler)  │
│   └─ pricing/db/config/...           │  shared helpers
│                                      │
│  scripts/run-batch.ts                │  CLI runner for long batches
└─────────────┬────────────────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│  Supabase (Postgres)                 │  source of truth
└──────────────────────────────────────┘
```

### Golden Rules

1. **Client components are DUMB** — display data, fire actions. Zero business logic. Never import from `lib/db.ts` or `lib/services/*` (server-only — `import "server-only"` enforces this).
2. **Route Handlers are THIN** — validate input (zod), call into `lib/`, return `{ success, data | error }`. No business logic inline.
3. **`lib/` is the BRAIN** — all orchestration, all external calls, all rules.
4. **DB is the MEMORY** — `leads` and `batches` are the source of truth; no client-side state duplication.
5. **Each pipeline stage is ATOMIC** — one file = one stage = one responsibility. Idempotent.
6. **Templates are built ONCE per niche** — sites are personalized via data injection + AI copy, never re-generated from scratch.
7. **Never burn paid API calls without confirmation** — Apify / Google Places / Outscraper / Gemini / verification (ZeroBounce, Hunter) / real email sends all cost money or sender reputation. If a stage fails, fix and ask before re-running.

---

## Directory Structure

```
SCRAPING BUSINESS GOOGLE MAP/
│
├── CLAUDE.md                       ← THIS FILE — source of truth
├── README.md                       ← Human setup instructions
├── .env.example                    ← Template for .env (no secrets)
├── .env                            ← Real secrets (gitignored)
├── .gitignore
│
├── web/                            ← Next.js app (frontend + API + pipeline)
│   ├── README.md                   ← Stack-specific docs + dashboard UX
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   ├── postcss.config.mjs
│   │
│   ├── app/                        ← App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx                ← placeholder; user builds dashboard
│   │   ├── globals.css
│   │   └── api/                    ← thin route handlers (validate → lib/)
│   │       ├── health · pricing/{estimate,compare}
│   │       ├── batches/[id]/{route,run}
│   │       ├── leads/[id]/{route, build, email, sequence, regenerate,
│   │       │                meeting, improve, handover}
│   │       ├── email/sync          ← IMAP reply/bounce pull
│   │       ├── email-accounts/{route, bluehost, test, [id]}  ← connect/test/remove mailbox
│   │       ├── campaigns/… · social/… · verify/sync · sites/[lead_id]
│   │       └── webhooks/{instantly [historical], stripe [stub]}
│   │
│   ├── lib/                        ← Server-side TS modules
│   │   ├── config.ts               ← zod-parsed env → `env` singleton
│   │   ├── db.ts                   ← Supabase service-role client (server-only)
│   │   ├── logger.ts               ← pino structured logger
│   │   ├── retry.ts                ← exponential backoff wrapper
│   │   ├── slugify.ts
│   │   ├── filters.ts              ← lead qualification rules
│   │   ├── pricing.ts              ← per-scraper cost estimator
│   │   ├── response.ts             ← uniform { success, data | error }
│   │   ├── services/             ← one file per provider:
│   │   │     apify · google-places · outscraper · gemini · cloudflare-pages
│   │   │     email-sender · smtp-sender · email-reader · auto-reply-detector
│   │   │     screenshot · mobivate · website-auditor · social-search · cloud-run
│   │   │     email-validator/ (zerobounce, hunter, …) · instantly [deprecated] …
│   │   └── pipeline/
│   │       ├── orchestrator.ts        ← stage-1 batch driver
│   │       ├── stage-1-scrape.ts
│   │       ├── stage-2-enrich.ts
│   │       ├── stage-3-generate.ts    (+ html-template-render.ts)
│   │       ├── stage-4-deploy.ts
│   │       ├── stage-4b-screenshot.ts ← demo screenshot → Supabase Storage
│   │       ├── stage-5-email.ts       ← single cold email (has-website leads)
│   │       ├── stage-6-sms.ts         ← Mobivate one-time link (dormant)
│   │       ├── sequence-scheduler.ts  ← the 4-step screenshot-first ladder
│   │       ├── build-lead.ts · build-gate.ts · improve.ts · handover.ts
│   │       └── stage-5-outreach.ts    ← DEPRECATED (Instantly; historical only)
│   │
│   └── scripts/
│       └── run-batch.ts            ← CLI: npm run run:batch -- <id>
│
├── db/                             ← DB schema + migrations (language-agnostic)
│   ├── schema.sql                  ← Authoritative table definitions
│   └── migrations/
│       ├── 001_initial.sql
│       └── 002_add_scraper.sql
│
├── templates/                      ← Site templates (one per vertical)
│   ├── README.md
│   ├── premium-trades/ · trades/ · dental-site/ · chiropractic-site/
│   └── restaurant-site/ · auto-site/   ← niche single-file HTML (token-swap) + Astro
│
├── workflows/                      ← WAT SOPs (markdown, one per task)
├── skills/                         ← Project-scoped Claude Code skills
└── docs/                           ← Architecture, ADRs, weekly status
    ├── architecture.md
    ├── data_model.md
    ├── stage_specs.md
    ├── deployment.md
    ├── decisions/
    └── status/                     ← YYYY-Www.md per ISO week
```

### File-naming conventions (so you can find anything fast)

- Pipeline stages: `stage-<N>-<verb>.ts` — number = run order, verb = what it does.
- External-API clients: `lib/services/<provider>.ts` — one provider per file.
- Route Handlers: `app/api/<resource>/[<param>/]route.ts` — REST resource = folder.
- Workflows: `workflows/<verb>_<object>.md` — imperative.
- Skills: `skills/<kebab-name>/SKILL.md`.
- Status logs: `docs/status/YYYY-Www.md` (ISO week).

### Required header on every TS file

```typescript
/**
 * <filename> — <one-line purpose>
 *
 * Inputs:  <what it reads>
 * Outputs: <what it writes>
 * Used by: <who calls this>
 */
```

This is non-negotiable. The point is: open any file, read 4 lines, know what it does and how it fits.

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Postgres + server writes (service role); also Storage (screenshots) | yes |
| `APIFY_TOKEN` | Default scraper (Apify Google-Maps actor) | one-of scrapers |
| `GOOGLE_PLACES_API_KEY` | Google Places scraper (cap 60/query) | one-of scrapers |
| `OUTSCRAPER_API_KEY` | Outscraper scraper (cap 500/query) | one-of scrapers |
| `GOOGLE_GENAI_API_KEY` / `GOOGLE_GENAI_MODEL` | Gemini site copy (free ≈1,500/day; default `gemini-2.5-flash`) | yes |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Pages deploy | yes |
| `ZEROBOUNCE_API_KEY` / `HUNTER_API_KEY` / `MILLIONVERIFIER_API_KEY` | Email verification ladder (gates sending) | yes (ZB) |
| `SMTP_PROBE_HELO` / `SMTP_PROBE_FROM` | Verification-probe identity (default `rateupdigital.com`) | no |
| `MOBIVATE_API_BASE` / `_API_KEY` / `_SENDER_ID` | SMS (dormant — soft no-op when unset) | no |
| `GCP_PROJECT_ID` / `GCP_REGION` / `CLOUD_RUN_JOB_NAME` / `GCP_WORKLOAD_IDENTITY_PROVIDER` / `GCP_SERVICE_ACCOUNT_EMAIL` | Trigger the Cloud Run job from Vercel (WIF, no keys) | yes (prod) |
| `PROXY_SERVER` / `_USERNAME_TEMPLATE` / `_PASSWORD` | Residential proxy for FB/IG fetches | no |
| `BRANDFETCH_API_KEY` · `SCRAPINGBEE_API_KEY` · `GOOGLE_CSE_API_KEY`/`_CSE_ID` | logo / SERP / social-URL discovery (graceful no-op) | no |
| `EMAIL_SENDING_PAUSED_UNTIL` | Global kill switch — halts ALL sends while in the future | no |
| `PMS_BASE_URL` / `PMS_PROJECT_ID` / `PMS_SESSION_COOKIE` | External PMS sync (see PMS section) | no |
| `INSTANTLY_API_KEY` | DEPRECATED (historical webhook only) | no |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing (later — webhook is a stub) | later |
| `APP_ENV` · `PORT` · `LOG_LEVEL` | runtime | yes/no |

> **Outbound mailboxes are NOT env vars** — they're rows in `email_accounts` (Bluehost/Titan SMTP+IMAP), connected/removed in the dashboard. `VAPI_*` / `ELEVENLABS_*` may linger in `.env` from the removed voice feature — inert here.

See `.env.example` for the canonical list. The `.env` file lives at **the repo root** (not inside `web/`) — Next.js, the CLI script, and the Cloud Run deploy all load from there.

---

## Database Schema (essentials)

Authoritative SQL: `db/schema.sql`. Summary:

### `batches`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `niche` | text | e.g. `plumbers`, `salons` |
| `city` | text | e.g. `Austin, TX` |
| `template_slug` | text | which template to use |
| `scraper` | text | `google_places` (default) or `outscraper` — picks stage-1 provider |
| `limit` | int | requested cap; per-scraper cap may truncate (Places=60, Outscraper=500) |
| `estimated_cost_usd` | numeric | populated at create-time from `lib/pricing.ts` |
| `status` | text | `queued` / `running` / `done` / `failed` |
| `created_at` | timestamptz | |

### `leads`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `batch_id` | uuid FK → batches | |
| `business_name` | text | |
| `phone` | text | |
| `address` | text | |
| `category` | text | Google Maps category |
| `rating` | numeric | |
| `review_count` | int | |
| `has_website` | bool | scraped value — `false` is our target |
| `email` | text | enriched, may be null |
| `brand_color` | text | hex extracted from logo/photo |
| `photos` | jsonb | array of URLs / Places photo names |
| `reviews` | jsonb | sample of top reviews (Places Pro tier returns empty) |
| `service_areas` | jsonb | array of city names (post-improve, customer-supplied) |
| `business_hours` | jsonb | `{ mon: "8am-5pm", ... }` (post-improve) |
| `stage` | text | see lifecycle below |
| `demo_url` | text | live Cloudflare Pages URL (`<slug>.pages.dev`) |
| `custom_domain` | text | attached at handover (e.g. `joesplumbing.com`) |
| `handover_mode` | text | `attach` or `transfer` |
| `notes` | text | operator scratch — meeting notes etc. |
| `last_error` | text | from last failed stage, if any |
| `screenshot_url` / `screenshot_captured_at` | text/ts | demo screenshot (Supabase Storage); embedded in email step 2+ |
| `seq_status` / `seq_step` / `seq_next_step_at` / `seq_sender_email` | — | screenshot-first sequence state (migration 034) |
| `verification_status` | text | `valid`/`invalid`/`catch-all`/`unknown` — gates email send |
| `call_segment` / `primary_offer` / `secondary_offer` | text | routing by segment (see **Offer strategy** below): no_website→build website, old_website→improve website, has_website→AI services (booking/receptionist). `voice_agent` offer value = parked/inert. |
| `website_score` / `needs_improvement` / `website_url` / `website_kind` / `website_status` | — | website-audit signals |
| `lifecycle_stage` / `inbox_status` | text | suppression (`unsubscribed`/`dnc`) + inbox triage |
| `created_at` / `updated_at` | timestamptz | |

> Authoritative + complete column list: `db/schema.sql` (migrations through **034**). The table above is a summary.

**Lifecycle (`leads.stage`):**
`scraped` → `enriched` → `generated` → `deployed` → `outreached` → (webhook) `replied` → `meeting_booked` → `meeting_done` → `improved` → `handed_over` → `closed_won` / `closed_lost` / `dead`. `needs_email` is a side-state when stage 5 has no email.

### Offer strategy by segment (IMPORTANT)

The website builder is only for businesses that NEED a site. **Never pitch a website to a business that already has a good one** — offer a different service.

- **no_website** (no real site) → **Build** a demo website; run the screenshot-first sequence.
- **old_website** (real but weak/dated — `needs_improvement=true`) → **Improve**: pitch a modern rebuild demo.
- **has_website** (real + healthy site, e.g. an established restaurant) → **DO NOT build or pitch a website.** Offer **AI services** instead — AI booking/reservations, AI receptionist/phone, AI chat/lead-capture, etc.

The classifier already segments these correctly (`deriveSegment` in `lib/segment.ts` → `routeOffer` in `lib/offers.ts`); the only gap is the offer attached to `has_website` — the legacy `voice_agent` value is parked, so treat the has_website offer as **"AI services"** going forward. (Building a demo site for a has_website lead, as in template QA, is a manual action — the pipeline does not auto-do it.)

### `outreach_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `lead_id` | uuid FK → leads | |
| `kind` | text | `email_sent`(meta.step) / `email_reply` / `email_bounced` / `email_send_failed` / `email_unsubscribe` / `email_auto_reply` / `sms_sent` … |
| `meta` | jsonb | provider payload |
| `created_at` | timestamptz | |

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | Liveness check |
| `/api/batches` | POST | Create + queue a new batch (returns cost preview) |
| `/api/batches` | GET | List batches with status |
| `/api/batches/:id` | GET | Batch detail + lead counts per stage |
| `/api/batches/:id/run` | POST | Re-trigger pipeline (small batches; use CLI for big ones) |
| `/api/leads` | GET | List with filters: batch, stage |
| `/api/leads/:id` | GET / PATCH | Inspect / hand-edit a lead |
| `/api/leads/:id/build` | POST | Build the demo site (Cloud Run: stages 2→4b) |
| `/api/leads/:id/email` | POST | Send the single cold email (has-website lead) |
| `/api/leads/:id/sequence` | POST | `{action: enroll \| stop \| recapture}` the screenshot sequence |
| `/api/leads/:id/regenerate` | POST | Force re-run from a given stage |
| `/api/email/sync` | POST | Pull IMAP replies/bounces; stops sequences on reply/bounce/unsub |
| `/api/email-accounts` + `/bluehost` `/test` `/:id` | GET/POST/DELETE | List / connect / test / remove a sending mailbox |
| `/api/leads/:id/meeting` | POST | Mark meeting `booked` / `done` + append notes |
| `/api/leads/:id/improve` | POST | Re-generate site with customer-supplied photos / copy / hours |
| `/api/leads/:id/handover` | POST | Attach custom domain (`mode: attach`) or record transfer |
| `/api/sites/:lead_id` | GET | Demo-site URL + deploy status |
| `/api/pricing/estimate?scraper=&limit=` | GET | Single-scraper cost preview (no paid calls) |
| `/api/pricing/compare?limit=` | GET | Side-by-side cost preview for both scrapers |
| `/api/webhooks/instantly` | POST | DEPRECATED — historical reply/open/bounce events only |
| `/api/webhooks/stripe` | POST | Stub (billing later) |

All responses: `{ success: true, data: {...} }` or `{ success: false, error: "..." }`.

---

## Skills (Claude Code, project-scoped)

Located in `skills/`. Invoke with `/<skill-name>`.

| Skill | What it does |
|-------|--------------|
| `pipeline-runner` | Walk operator through running a full batch end-to-end |
| `lead-qualifier` | Apply filter rules and report which leads to drop |
| `site-generator` | Generate / regenerate one demo site, debug template issues |
| `site-auditor` | Audit a prospect's existing website (build vs improve signal) |
| `template-component-hunter` | Find + install premium UI components into the niche templates |
| `outreach-composer` | Compose / refine the screenshot-first email + SMS copy |
| `status-reporter` | Read recent activity + write the weekly `docs/status/` entry |
| `voice-agent-trainer` | (parked) voice-script tuning — voice calling moved to a separate app |

See `skills/README.md` for how each is wired.

---

## Status Updates

- **Weekly:** `docs/status/YYYY-Www.md` — one markdown file per ISO week. Sections: *Done*, *In progress*, *Blocked*, *Numbers* (leads scraped, sites deployed, replies, closes), *Next week*.
- **Daily (when active):** append a `### YYYY-MM-DD` block to the current week's file.
- **Trigger:** run `/status-reporter` skill or open the file directly.
- **End-of-task report (on request / end of day):** plain-English and NON-technical — one outcome per line, focused on what got done and what it MEANS for the operator. **Never** a commit/deploy/code-change log. Two sections:
  - **task for today:** one bullet per thing accomplished, in plain terms a non-dev understands (the benefit, not the code). End with a `Result: …` line and a `Still to do next time: …` line.
  - **pending/still in progress:** what isn't finished or is waiting (keys, mailbox, approvals, parked work).
  Keep it short + copy-friendly. Also append a matching `### YYYY-MM-DD` block (same two sections) to the current week's `docs/status/` file.

The status file is the canonical record. CLAUDE.md is "how the system works," `docs/status/` is "what happened lately."

---

## Keep the External PMS in Sync (do this without being asked)

This project is tracked in an external Project Management System (PMS). **Keep its project record current proactively — don't wait to be reminded.**

- **Tool:** `web/scripts/pms-update.ts` (run from `web/`). Read: `npx tsx scripts/pms-update.ts --get`. Update: pass `--name` / `--description` / `--status` / `--start` / `--end`.
- **When:** after a meaningful change ships, the focus shifts, or status genuinely changes — refresh the PMS in the same session, alongside the `docs/status/` update.
- **Auth:** the advertised bearer API token is NOT enabled on the deployment — only the NextAuth session cookie works. Set `PMS_SESSION_COOKIE` (and `PMS_BASE_URL`, `PMS_PROJECT_ID`) in the repo-root `.env`. The cookie expires (~30 days); when calls 401, ask for a fresh `authjs.session-token` from a logged-in browser.
- **Rules:** edits must be factual (derive from CLAUDE.md / real work, never fabricate) and reversible. `status` changes need MAINTAINER+ and may notify the team — only change it when it's truly accurate. A description ending in "Current focus: …" will drift — refresh that line as focus moves.
- Full context: see project memory `project_pms_integration` + `feedback_pms_keep_synced`.

---

## What Should NOT Change Without Explicit Request

- Database schema (write a migration; don't ALTER live tables ad-hoc)
- `.env` variable names (frontend + API + scripts all reference them)
- API response envelope `{ success, data | error }`
- `leads.stage` enum values (orchestrator + frontend filter on these)
- Pipeline stage **interface** (each stage takes a lead/batch object, returns or throws, updates DB) — internals can change freely

---

## Known Constraints

- **Apify (default scraper)**: Google-Maps actor, ~$3–4/1k, async; our safety cap 300/query.
- **Google Places**: Pro Text Search ~$35/1k, capped at **60/query** (3 pages of 20). $200/mo free credit ≈ 5,700 leads.
- **Google Places ToS**: only `place_id` is storable long-term — phone/address/reviews should be cached ≤30 days. ⚠️ Not currently enforced in code; if scaling on Places, add a retention/cleanup job.
- **Outscraper**: pay-per-lead (~$3/1k), 500 cap per query, batch requests; don't loop one-at-a-time.
- **Google Gemini API**: free tier = 1,500 req/day on Flash. Paid only past that.
- **Cloudflare Pages**: 500 deploys/month per project; one project per site, so the global limit is API rate (~1200/5min).
- **Email sending**: via connected `email_accounts` (SMTP). New mailboxes need **2–3 weeks warm-up** (daily caps ramp automatically); sends are **verification-gated** (only `valid`/`catch-all`) and stop on reply/bounce/unsubscribe. Global kill switch: `EMAIL_SENDING_PAUSED_UNTIL`.
- **Screenshots / Playwright**: need Chromium → run on the **Cloud Run job only** (no local Chromium; capture no-ops locally).
- **Serverless timeouts**: don't run long work (scrape/build/screenshot/sequence) in a Vercel Route Handler (60s). Use the Cloud Run job (`MODE=…`) or the CLI.
- **GDPR**: do not target EU prospects until compliance is reviewed (⚠️ not gated in code).

---

## Coding Standards

### Do
- One TS module = one responsibility (one stage, one provider, one route file).
- Every file starts with the required docstring header (see Directory Structure).
- All external API calls go through `lib/services/<provider>.ts` — never inline.
- All external calls have retry w/ exponential backoff (`lib/retry.ts`).
- Log every external API call with timestamp + outcome via `lib/logger.ts`.
- Strict mode on (`tsc --noEmit` clean before commit). Use zod at every boundary.
- Write the workflow markdown FIRST, code SECOND.

### Don't
- Don't call external services from client components.
- Don't import `lib/db.ts` or `lib/services/*` outside `app/api/`, `lib/pipeline/`, or `scripts/`. The `import "server-only"` guard will fail the build if you try.
- Don't store secrets in `NEXT_PUBLIC_*` env vars or commit them anywhere.
- Don't rerun a paid stage without checking with the operator.
- Don't generate sites without a working template — sites are only as good as the template.
- Don't add new dependencies without updating `package.json` and noting why in the commit.

---

## Quick Reference

| Task | Command (run from `web/` unless noted) |
|------|---------|
| Install deps | `npm install` |
| Start dev server | `npm run dev` (http://localhost:3000) |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |
| Run a scrape batch (CLI) | `npm run run:batch -- <batch_id>` |
| Create + run a new batch | `npm run run:batch -- --niche=plumber --city="Austin, TX" --scraper=apify --limit=60` |
| Cloud Run job (any mode) | `npm run run:job` with `MODE=batch\|build\|regenerate\|screenshot\|sequence` (+ LEAD_ID/BATCH_ID) |
| Deploy the Cloud Run job | `bash scripts/deploy-cloud-run-job.sh` (builds image from local source) |
| Run tests | `npm test` (vitest) |
| Apply DB migration | run the SQL in Supabase SQL editor (or `psql`); latest = `034` |
| Production deploy | push `main` → Vercel auto-deploys (build first) |

---

## Commit Messages (Conventional Commits)

Format: `<type>(<scope>): <summary>`

Types: `feat`, `fix`, `refactor`, `style`, `perf`, `docs`, `chore`, `test`.
Scopes for this project: `web`, `api`, `pipeline`, `template`, `db`, `skill`, `workflow`, `docs`, `config`.

Rules:
- Imperative mood, lowercase after colon, no trailing period, ≤72 chars.
- Body explains *why* if non-obvious.

After every change, end the response with:

````
---
**Suggested commit:**
```
<type>(<scope>): <summary>
```
````
