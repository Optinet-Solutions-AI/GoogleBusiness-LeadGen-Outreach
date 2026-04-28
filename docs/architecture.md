# Architecture

This is the long-form companion to the architecture summary in [`CLAUDE.md`](../CLAUDE.md). Pulled out so CLAUDE.md stays small.

## Mental model

The system is a **conveyor belt**. A `lead` row enters one end (scraped from Google Maps) and exits the other (closed customer or dead). Five stages move it along:

```
scraped → enriched → generated → deployed → outreached → replied → closed
                                                       ↘ dead
```

Each stage:
- has exactly one TS module (`web/lib/pipeline/stage-<N>-<verb>.ts`)
- reads its predecessor's output from the `leads` row
- writes its own output back to the same row + flips `lead.stage`
- is **idempotent** — re-running on the same lead doesn't double-charge or double-send

The orchestrator (`web/lib/pipeline/orchestrator.ts`) is a thin loop that walks every lead in a batch through whatever stages it hasn't finished yet.

## Why this shape

Three pressures:

1. **Cost discipline.** Every stage involves a paid API. Idempotent + per-lead-state means a crash mid-batch costs us at most the in-flight lead, not the whole batch.
2. **Operator control.** A lead can be "stuck" at any stage indefinitely (e.g. waiting on email lookup). The frontend can re-trigger a single stage on a single lead without disturbing the rest.
3. **Replaceability.** Today scraping is Outscraper. Tomorrow it could be a custom Playwright scraper. Because each stage is its own file with one provider client behind it, swap is local.

## Layers

```
Next.js app (web/)             single TypeScript app
├── app/ (pages + Route Handlers)
│      │ in-process imports
│      ▼
├── lib/services/  ────────►  External APIs (Places, Outscraper, Claude, CF, Instantly)
├── lib/pipeline/             the brain (5 stages)
└── lib/db.ts      ────────►  Postgres (Supabase)  ← single source of truth

scripts/run-batch.ts (CLI)   long-running pipeline runner
```

Client components do **not** talk to external services. They call `/api/*`. Route Handlers are thin: validate → call into `lib/`. The pipeline writes to the DB, Route Handlers read the DB, the dashboard reads the API.

## Templates as a separate first-class concern

`templates/<niche>/` is its own thing — Astro projects with their own `package.json`. They're consumed at build-time by `lib/pipeline/stage-3-generate.ts` (which shells out to `npm run build`). The reason templates are separate from `web/` is so a designer can iterate on a template (`npm run dev` in `templates/trades`) without touching the app.

A template is the asset that **does the selling**. Spending real design effort here is the whole game.

## What's intentionally not here yet

- **Job queue.** `runBatch()` runs in-process from the CLI script. The HTTP `/api/batches/:id/run` endpoint fires it as a fire-and-forget Promise — fine for tiny re-runs but **not reliable on serverless** (function exits, work dies). When concurrency matters or you deploy to Vercel/Cloudflare, wire Inngest or Cloudflare Queues here.
- **Auth.** No auth on `/api/*` yet. Wire Supabase Auth or a bearer token before exposing publicly.
- **Email finder.** Stage 2 leaves `email = null`. Plug Hunter or Apollo in there.
- **Custom domain.** Right now sites land on `*.pages.dev`. Wire a wildcard subdomain on a real domain when domain warmup is done.
