# Web — Next.js app (frontend + API + pipeline)

Single Next.js 14 (App Router) project. Houses **everything that runs on Node:**

- `app/` — operator dashboard pages (placeholder; user builds the real UI)
- `app/api/` — Route Handlers (the HTTP API)
- `lib/` — shared TypeScript modules (config, db, services, pipeline, helpers)
- `scripts/` — CLI entrypoints (long-running pipeline runner)

The **Astro site templates** live one directory up at `templates/<niche>/` so a designer can iterate on them without touching this app.

## Quick start

```bash
# from this directory:
cp ../.env.example ../.env       # fill in real keys (or leave blank — pricing endpoints work standalone)
npm install
npm run dev                       # http://localhost:3000

# in another terminal — run a real batch from the CLI
npm run run:batch -- --niche=plumber --city="Austin, TX" --scraper=google_places --limit=60
```

## Layout (every file has a header docstring)

```
app/
├── layout.tsx                 ← root layout
├── page.tsx                   ← placeholder home
├── globals.css                ← Tailwind imports
└── api/
    ├── health/route.ts
    ├── pricing/
    │   ├── estimate/route.ts
    │   └── compare/route.ts
    ├── batches/
    │   ├── route.ts           ← POST + GET
    │   └── [id]/
    │       ├── route.ts       ← GET detail + stage counts
    │       └── run/route.ts   ← POST re-trigger
    ├── leads/
    │   ├── route.ts           ← GET list (filters)
    │   └── [id]/
    │       ├── route.ts       ← GET / PATCH
    │       ├── regenerate/route.ts  ← POST re-run from stage
    │       ├── meeting/route.ts     ← POST mark meeting booked / done
    │       ├── improve/route.ts     ← POST re-gen w/ customer photos+copy
    │       └── handover/route.ts    ← POST attach custom domain
    ├── sites/[lead_id]/route.ts
    └── webhooks/
        ├── instantly/route.ts
        └── stripe/route.ts

lib/
├── config.ts                  ← zod-parsed env vars → `env` singleton
├── logger.ts                  ← pino structured logger
├── db.ts                      ← Supabase service-role client (server-only)
├── retry.ts                   ← exponential backoff wrapper
├── slugify.ts
├── filters.ts                 ← lead qualification rules
├── pricing.ts                 ← per-scraper cost estimator
├── response.ts                ← uniform { success, data | error } JSON
├── services/                  ← one file per external API
│   ├── types.ts               ← NormalizedLead shape (shared)
│   ├── google-places.ts
│   ├── outscraper.ts
│   ├── gemini.ts              ← site copy generation (free tier)
│   ├── color-extractor.ts
│   ├── cloudflare-pages.ts    ← exposes attachCustomDomain() for handover
│   └── instantly.ts
└── pipeline/
    ├── orchestrator.ts        ← runs the 5 stages
    ├── stage-1-scrape.ts
    ├── stage-2-enrich.ts
    ├── stage-3-generate.ts
    ├── stage-4-deploy.ts
    ├── stage-5-outreach.ts
    ├── improve.ts             ← post-meeting: rebuild w/ customer data
    └── handover.ts            ← attach custom domain to existing project

scripts/
└── run-batch.ts               ← CLI: bun/tsx scripts/run-batch.ts <id>
```

## Naming conventions

- Pipeline stages: `stage-<N>-<verb>.ts`.
- External-API clients: `lib/services/<provider>.ts`, one provider per file.
- Route Handlers: `app/api/<resource>/[<param>/]route.ts`.
- Every TS file starts with a docstring header (purpose, inputs, outputs, used by).

## Why CLI for the pipeline (not Route Handlers)

Stage 3 builds an Astro site (~30s on a cold cache) and stage 4 deploys to Cloudflare (~10s/lead). Vercel/Cloudflare Functions have short timeouts (60s default on Vercel free, 300s on Pro). For batches that take minutes, the CLI script is the right tool — run it from your terminal, or run it as a long-lived worker (Inngest, Cloudflare Workers Cron, a tiny VPS) in production.

The `POST /api/batches/[id]/run` Route Handler exists for "kick off a small re-run from the dashboard" but it's fire-and-forget and unreliable on serverless. Don't depend on it for production batch volume.

## Dashboard UX (what to build)

See [`../docs/architecture.md`](../docs/architecture.md) for the system overview and the page outline below.

### Page: Batches
- "New batch" modal with:
  - Inputs: niche, city, template
  - **Scraper toggle**: `[ Google Cloud Places ]  [ Outscraper ]` (default Places)
  - Limit slider (1–500). Auto-snaps to scraper cap (60 Places, 500 Outscraper).
  - **Cost chip** (live): `GET /api/pricing/estimate?scraper=...&limit=...` on every change. Shows `~$X.XX (Y leads after cap)` + warnings.
  - Submit → POST `/api/batches`. Show returned `estimated_cost_usd`.
- Table: niche, city, scraper, status, leads-by-stage bar, est-cost, created_at.

### Page: Batch detail
- Stage funnel (scraped → enriched → … → outreached) with counts.
- Lead table filtered by this batch.

### Page: Lead detail
- All fields editable: email, brand_color, stage.
- "Regenerate from <stage>" buttons.
- "Open demo" link to `lead.demo_url`.
- Outreach event timeline.

### Page: Replies
- Leads where `stage = 'replied'`, most recent first.
- Quick actions: mark closed / dead, write a reply.

### Page: Status
- Render the current week's `docs/status/<YYYY-Www>.md` as markdown.

## Don'ts

- Don't import from `lib/db.ts` or `lib/services/*` in client components — they're server-only and will leak server keys to the browser bundle. The `import "server-only"` guard in `db.ts` will fail the build if you do.
- Don't bake API keys into client env vars (`NEXT_PUBLIC_*`).
- Don't long-poll the pipeline from a serverless function — use the CLI or a queue.
