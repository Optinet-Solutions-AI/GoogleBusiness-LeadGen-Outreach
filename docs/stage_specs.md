# Stage Specs

Each pipeline stage has a strict input/output contract. Don't change these without updating the orchestrator.

## Common contract

Every stage module exposes a `run(...)` function:

```typescript
// Batch-level (stage 1)
export async function run(batch: Batch): Promise<{ accepted: number; rejected: number }>;

// Lead-level (stages 2–5)
export async function run(lead: Lead, ...extra): Promise<ReturnType>;
```

Every stage:
1. Logs `<stage>.start` on entry.
2. Updates `lead.stage` (or `batch.status`) on success.
3. Throws on failure. The orchestrator persists `lead.last_error` (or `batch.status='failed'`).

## Stage 1 — scrape

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/stage-1-scrape.ts` |
| Inputs | `batch` row |
| Outputs | N `leads` rows at `stage='scraped'` |
| Cost | scraper-dependent (Places ~$35/1k, Outscraper ~$3/1k) |
| Idempotent? | Yes — `(place_id, batch_id)` unique constraint |

## Stage 2 — enrich

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/stage-2-enrich.ts` |
| Inputs | one `lead` at `stage='scraped'` |
| Outputs | same lead, `brand_color` set, `stage='enriched'` |
| Cost | local color extraction is free; resolving Google Places photo URLs is $0.007 each |
| Idempotent? | Yes |

## Stage 3 — generate

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/stage-3-generate.ts` |
| Inputs | one `lead` at `stage='enriched'`, `templateSlug`, optional `overrides` (copy + photos) |
| Outputs | `.tmp/generated-sites/<slug>/dist/`, lead `stage='generated'` |
| Cost | Gemini API — free tier 1,500 req/day |
| Idempotent? | Yes — overwrites previous dist |
| Output structure | Multi-page: `/`, `/about`, `/services`, `/services/<slug>`, `/service-area`, `/contact` |

## Stage 4 — deploy

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/stage-4-deploy.ts` |
| Inputs | one `lead` at `stage='generated'` (dist must exist on disk) |
| Outputs | `lead.demo_url` set, `stage='deployed'` |
| Cost | free (Cloudflare Pages) |
| Idempotent? | Yes — Cloudflare project create is idempotent (409 on re-create); deployments stack |

## Stage 5 — outreach

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/stage-5-outreach.ts` |
| Inputs | one `lead` at `stage='deployed'` with `email` + `demo_url` |
| Outputs | `outreach_events` row, lead `stage='outreached'` (or `needs_email` if email is null) |
| Cost | Instantly per-seat pricing (no per-email cost) |
| Idempotent? | **Not yet** — re-running will add the lead to the campaign twice. Fix: query Instantly for existing membership before adding. |

## Lifecycle helpers (post-pipeline)

These don't fit the stage 1–5 contract — they're triggered by operator action after a reply.

### `improve` (re-gen with customer data)

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/improve.ts` |
| Trigger | `POST /api/leads/:id/improve` |
| Inputs | lead, `{ photos?, copy?, service_areas?, business_hours?, brand_color?, notes? }` |
| Outputs | rebuilt + redeployed site, lead `stage='improved'` |
| Cost | one Gemini call, one Cloudflare deploy |
| Idempotent? | Yes — operator-supplied data is persisted onto the lead and re-read each call |

### `handover` (give the customer their domain)

| Field | Value |
|-------|-------|
| Module | `web/lib/pipeline/handover.ts` |
| Trigger | `POST /api/leads/:id/handover` |
| Inputs | lead, `{ mode: 'attach' \| 'transfer', custom_domain? }` |
| Outputs | `attach`: domain attached to the existing CF Pages project, lead `stage='handed_over'`. `transfer`: intent recorded only — manual CF dashboard step required. |
| Cost | free |
| Idempotent? | Yes — re-attaching the same domain returns OK |

## What to change when adding a new stage

If you ever add a stage 6 (e.g. `stage-6-followup-call.ts`):
1. Add the stage file with the same contract.
2. Add the new `lead.stage` value to:
   - `db/schema.sql` `check (stage in (...))`
   - `docs/data_model.md` table
   - `web/lib/pipeline/orchestrator.ts` loop branch
3. Update the pipeline diagram in `CLAUDE.md` and `docs/architecture.md`.
