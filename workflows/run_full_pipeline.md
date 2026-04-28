# Workflow — Run the full pipeline for a niche/city

**Objective:** From a niche + city, end up with deployed demo sites and queued cold-email outreach for every qualifying lead.

## Inputs
- `niche` — e.g. `plumber`, `salon`, `restaurant`
- `city` — e.g. `Austin, TX`
- `template_slug` — must match a folder under `templates/` (default `trades`)
- `limit` — max leads to scrape (default 100)

## Tools
- `web/scripts/run-batch.ts` (CLI runner)
- `web/lib/pipeline/orchestrator.ts` (the engine)
- requires: SUPABASE, GOOGLE_PLACES (or OUTSCRAPER), GOOGLE_GENAI, CLOUDFLARE, INSTANTLY env vars

## Steps

1. **Pre-flight check.**
   - `psql "$SUPABASE_URL" -c "select 1"` — DB reachable.
   - Confirm `templates/<template_slug>` exists.
   - Hit `GET /api/pricing/estimate?scraper=...&limit=...` to preview spend.
   - Confirm operator approves the estimated total.

2. **Create + run batch (CLI — recommended for any non-trivial batch).**
   ```bash
   cd web
   npm run run:batch -- --niche=plumber --city="Austin, TX" \
       --template=trades --scraper=google_places --limit=60
   ```
   Or trigger via API (small batches only — serverless function will timeout on big ones):
   ```bash
   curl -X POST http://localhost:3000/api/batches \
       -H "Content-Type: application/json" \
       -d '{"niche":"plumber","city":"Austin, TX","template_slug":"trades","scraper":"google_places","limit":60}'
   ```

3. **Monitor.**
   ```sql
   select stage, count(*) from leads where batch_id = '<id>' group by stage;
   ```
   Or `GET /api/batches/<id>` (returns stage_counts inline).

4. **Hand-fix as needed.**
   - Leads stuck at `needs_email`: find emails (Hunter, Apollo) and `PATCH /api/leads/<id>` with `{ "email": "..." }`.
   - Leads with `last_error`: read it, fix the underlying issue, then `POST /api/leads/<id>/regenerate` with `{ "from_stage": "..." }`.

## Expected Outputs
- `batches.status = 'done'`
- A row per qualifying lead in `leads` at stage `outreached` or `needs_email`
- A live URL on `<slug>.<root>` per deployed lead
- `outreach_events` row per email sent

## Known issues / lessons
- Outscraper occasionally returns leads with `has_website = null` instead of `false` — `filters.qualifies` handles this safely.
- First template build is slow (~30s) because of `npm install`. After that, builds are ~5s each.
- Cloudflare deploys can 503 transiently — retry decorator handles it.

## Stop / resume
The pipeline is idempotent. If the operator kills it mid-batch, re-running `POST /api/batches/<id>/run` picks up from each lead's current `stage`. No paid API calls are repeated.
