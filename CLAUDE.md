# CLAUDE.md — Local Lead-Gen & Auto-Site Pipeline

> Source of truth for this project. Loaded into every Claude Code session.
> Keep concise. Update when reality drifts.

---

## Project Overview

End-to-end pipeline that turns a city + niche into paying website-hosting clients.
Scrape Google Maps for local businesses **without websites**, auto-generate a personalized demo site for each, deploy it to a unique subdomain, and send the prospect a link via cold email + follow-up call. Charge a setup fee + monthly hosting on close.

**Business purpose:** Recurring revenue from local SMBs. Generation cost ~$0.05/site; close price hundreds-to-thousands.

- **Stack:** TypeScript + Next.js 14 (App Router) + Tailwind CSS — single app for frontend, API, and pipeline
- **Pipeline runtime:** Node 20+ (CLI script `web/scripts/run-batch.ts`)
- **Database:** Supabase (Postgres) — free tier
- **Site templates:** Astro + Tailwind (static HTML output, separate folder per niche)
- **Hosting / CDN:** Cloudflare Pages (one project per generated site, unlimited free)
- **External services:** Outscraper *or* Google Places API (scraping — toggleable per batch), **Google Gemini API** (site copy, free-tier), Cloudflare Pages (hosting), Instantly.ai (email), Stripe (billing — later)
- **Default scraper for the pilot:** `google_places` (Google's $200/mo free credit covers it)

---

## How the App Works

```
1. Operator picks niche + city + scraper in dashboard, clicks "Run batch"
   ↓
2. POST /api/batches  → writes batch row, returns estimated cost
   ↓
3. Orchestrator runs 5 stages per lead (web/lib/pipeline/):
     stage-1-scrape   → Google Places (or Outscraper) → leads in DB
     stage-2-enrich   → brand color from photos, email lookup
     stage-3-generate → Astro multi-page template + Gemini-written copy → static site
     stage-4-deploy   → Cloudflare Pages → live URL on subdomain
     stage-5-outreach → Instantly.ai sends email w/ demo URL
   ↓
4. Replies tracked via webhook → lead.stage='replied'
   ↓
5. Operator workflow (post-reply):
     replied → meeting_booked → meeting_done
            → improve   (rebuild w/ customer's real photos + copy)
            → handover  (attach their custom domain to our Pages project)
            → closed_won  / closed_lost / dead
```

Each stage is **idempotent** — safe to re-run for any lead. Stage status is stored on the lead row; the orchestrator picks up where it left off.

The pipeline is run from a **CLI script**, not a serverless function — Astro builds + Cloudflare deploys are too long for a Route Handler. The HTTP `POST /api/batches/:id/run` endpoint exists for ad-hoc small re-runs but is not the production entrypoint.

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
│   ├─ pipeline/  (5 atomic stages)    │  the brain
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
7. **Never burn paid API calls without confirmation** — Outscraper / Google Places / Claude / Instantly all cost money. If a stage fails, fix and ask before re-running.

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
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── pricing/
│   │       │   ├── estimate/route.ts
│   │       │   └── compare/route.ts
│   │       ├── batches/
│   │       │   ├── route.ts        ← POST + GET
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── run/route.ts
│   │       ├── leads/
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── regenerate/route.ts
│   │       ├── sites/[lead_id]/route.ts
│   │       └── webhooks/
│   │           ├── instantly/route.ts
│   │           └── stripe/route.ts
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
│   │   ├── services/
│   │   │   ├── types.ts            ← NormalizedLead shape (shared)
│   │   │   ├── google-places.ts
│   │   │   ├── outscraper.ts
│   │   │   ├── gemini.ts
│   │   │   ├── color-extractor.ts
│   │   │   ├── cloudflare-pages.ts
│   │   │   └── instantly.ts
│   │   └── pipeline/
│   │       ├── orchestrator.ts
│   │       ├── stage-1-scrape.ts
│   │       ├── stage-2-enrich.ts
│   │       ├── stage-3-generate.ts
│   │       ├── stage-4-deploy.ts
│   │       └── stage-5-outreach.ts
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
├── templates/                      ← Astro site templates (one per vertical)
│   ├── README.md
│   └── trades/                     ← First template (plumbers, electricians)
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
| `SUPABASE_URL` | Postgres connection (Supabase project URL) | yes |
| `SUPABASE_SERVICE_KEY` | Server-side DB writes (service role) | yes |
| `OUTSCRAPER_API_KEY` | Google Maps scraping (when `batches.scraper = 'outscraper'`) | one-of |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) — default scraper | one-of |
| `GOOGLE_PLACES_DEFAULT_REGION` | ISO 3166-1 alpha-2 (e.g. `us`) | no |
| `GOOGLE_PLACES_DEFAULT_LANGUAGE` | BCP-47 (e.g. `en`) | no |
| `GOOGLE_GENAI_API_KEY` | Gemini API key for site copy. Free tier ≈ 1,500 req/day. Get at https://aistudio.google.com/app/apikey | yes |
| `GOOGLE_GENAI_MODEL` | Override model id (default `gemini-2.5-flash`) | no |
| `CLOUDFLARE_API_TOKEN` | Pages deploy auth | yes |
| `CLOUDFLARE_ACCOUNT_ID` | Pages account scope | yes |
| `INSTANTLY_API_KEY` | Cold email automation | yes |
| `STRIPE_SECRET_KEY` | Billing | later |
| `APP_ENV` | `development` / `production` | yes |
| `PORT` | Next.js dev port | `3000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |

See `.env.example` for the canonical list. The `.env` file lives at **the repo root** (not inside `web/`) — Next.js, the CLI script, and any other tools all load from there.

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
| `created_at` / `updated_at` | timestamptz | |

**Lifecycle (`leads.stage`):**
`scraped` → `enriched` → `generated` → `deployed` → `outreached` → (webhook) `replied` → `meeting_booked` → `meeting_done` → `improved` → `handed_over` → `closed_won` / `closed_lost` / `dead`. `needs_email` is a side-state when stage 5 has no email.

### `outreach_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `lead_id` | uuid FK → leads | |
| `kind` | text | `email_sent` / `email_opened` / `replied` / `email_bounced` |
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
| `/api/leads/:id/regenerate` | POST | Force re-run from a given stage |
| `/api/leads/:id/meeting` | POST | Mark meeting `booked` / `done` + append notes |
| `/api/leads/:id/improve` | POST | Re-generate site with customer-supplied photos / copy / hours |
| `/api/leads/:id/handover` | POST | Attach custom domain (`mode: attach`) or record transfer |
| `/api/sites/:lead_id` | GET | Demo-site URL + deploy status |
| `/api/pricing/estimate?scraper=&limit=` | GET | Single-scraper cost preview (no paid calls) |
| `/api/pricing/compare?limit=` | GET | Side-by-side cost preview for both scrapers |
| `/api/webhooks/instantly` | POST | Reply / open events |
| `/api/webhooks/stripe` | POST | Subscription events |

All responses: `{ success: true, data: {...} }` or `{ success: false, error: "..." }`.

---

## Skills (Claude Code, project-scoped)

Located in `skills/`. Invoke with `/<skill-name>`.

| Skill | What it does |
|-------|--------------|
| `pipeline-runner` | Walk operator through running a full batch end-to-end |
| `lead-qualifier` | Apply filter rules and report which leads to drop |
| `site-generator` | Generate / regenerate one demo site, debug template issues |
| `template-component-hunter` | Find and install premium UI components (21st.dev / typeui.sh / getdesign.md) into the niche templates |
| `outreach-composer` | Compose / refine cold-email sequences for Instantly |
| `status-reporter` | Read recent activity + write the weekly `docs/status/` entry |

See `skills/README.md` for how each is wired.

---

## Status Updates

- **Weekly:** `docs/status/YYYY-Www.md` — one markdown file per ISO week. Sections: *Done*, *In progress*, *Blocked*, *Numbers* (leads scraped, sites deployed, replies, closes), *Next week*.
- **Daily (when active):** append a `### YYYY-MM-DD` block to the current week's file.
- **Trigger:** run `/status-reporter` skill or open the file directly.

The status file is the canonical record. CLAUDE.md is "how the system works," `docs/status/` is "what happened lately."

---

## What Should NOT Change Without Explicit Request

- Database schema (write a migration; don't ALTER live tables ad-hoc)
- `.env` variable names (frontend + API + scripts all reference them)
- API response envelope `{ success, data | error }`
- `leads.stage` enum values (orchestrator + frontend filter on these)
- Pipeline stage **interface** (each stage takes a lead/batch object, returns or throws, updates DB) — internals can change freely

---

## Known Constraints

- **Google Places API (default)**: Pro Text Search ~$35/1k, capped at **60 results per query** (3 pages of 20). For >60-lead batches, vary the query (neighborhood split) or use Outscraper. $200/mo free credit covers ~5,700 leads at Pro tier.
- **Google Places ToS**: only `place_id` is storable long-term — phone/address/reviews must be cached ≤30 days. Direct-marketing usage is gray. **Don't make Places the system of record for the `leads` table** — it's there as the cheapest pilot path while we have credit; switch to Outscraper before scaling.
- **Outscraper**: pay-per-lead (~$3/1k), 500 cap per query, batch requests; don't loop one-at-a-time.
- **Google Gemini API**: free tier = 1,500 req/day on Flash. Paid only kicks in past that.
- **Cloudflare Pages**: 500 deployments/month on free tier per project; we use one project per site, so global limit is by API rate (~1200/5min).
- **Instantly.ai**: requires 2–3 weeks of domain warm-up before sending cold volume.
- **Serverless timeouts**: don't run `runBatch()` from a Route Handler for >60s of work. Use the CLI (`npm run run:batch`) or move to a queue (Inngest, Cloudflare Queues).
- **GDPR**: do not target EU prospects until compliance is reviewed.

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
| Run a full pipeline batch | `npm run run:batch -- <batch_id>` |
| Create + run a new batch | `npm run run:batch -- --niche=plumber --city="Austin, TX" --scraper=google_places --limit=60` |
| Build a template locally | `cd ../templates/trades && npm run build` |
| Apply DB migration | `psql "$SUPABASE_URL" -f ../db/migrations/<file>.sql` (from repo root) |
| Production build | `npm run build && npm start` |

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
