# Workflow — Scrape Google Maps (stage 1)

**Objective:** Pull every business matching a niche+city query from Google Maps, filter to qualifying leads, persist as `leads` rows.

## Inputs
- `batch` row (id, niche, city, **scraper**, limit)

## Tool
- `web/lib/pipeline/stage-1-scrape.ts` — dispatches on `batch.scraper`:
  - `google_places` → `lib/services/google-places.ts` (Places API New, ~$35/1k, **cap 60/query**, $200/mo free credit) — **default for the pilot**
  - `outscraper`    → `lib/services/outscraper.ts`     (~$3/1k, cap 500/query)

## Picking a scraper
- **Pilot (now):** `google_places` while the free credit is uncommitted.
- **Volume (>60/batch):** either split the query into multiple batches (e.g. by neighborhood) or switch the same batch to `outscraper`.
- **Reviews-grade copy:** Places (Pro tier) doesn't return reviews. If Claude needs reviews to write personalized copy, prefer Outscraper, or upgrade the Places field mask to Enterprise (cost rises).

## Cost preview before running
- Use `GET /api/pricing/estimate?scraper=...&limit=...` to preview without making any paid calls.
- The dashboard's "Run batch" modal pulls this on every toggle.

## Filter rules (web/lib/filters.ts)
A lead is **kept** only if all of:
- `has_website == false`
- `rating >= 4.0`
- `review_count >= 20`
- `phone` present
- `category` contains the batch niche (case-insensitive)

Anything else is dropped with a debug log line.

## Expected Outputs
- `leads` rows at `stage = 'scraped'` for every qualifier
- Outscraper response counted in logs (`stage_1.done accepted=N rejected=M`)

## Cost
Outscraper bills per lead returned (≈ $1–3 / 1000). For a 100-lead query, expect <$0.50.

## Known issues
- If Outscraper async mode is enabled, `search_google_maps` will block 30–60s. Keep `async=false` for pilot scale; switch to async polling when `limit > 500`.
- Rare: Outscraper returns the *same* place twice with different `place_id` formats. The `(place_id, batch_id)` unique constraint keeps it sane on insert.
