# Workflow — Enrich a lead (stage 2)

**Objective:** Add brand color and email contact to a lead so generation + outreach can proceed.

## Inputs
- `lead` at `stage = 'scraped'`

## Tool
- `web/lib/pipeline/stage-2-enrich.ts`
  - calls `lib/services/color-extractor.ts` (node-vibrant)
  - for Google Places photos, also calls `lib/services/google-places.ts:getPhotoUrl()` to resolve the resource name → image URL (extra $0.007/call billed)
  - email lookup is a TODO (Hunter / Apollo integration)

## What it does
1. Resolve first photo to a URL → `extractBrandColor()` → hex.
2. If no email already present, leave `email = null` and let stage 5 mark `needs_email`.
3. Update lead → `stage = 'enriched'`.

## Expected Outputs
- `lead.brand_color` populated (or fallback `#1F4E79`)
- `lead.stage = 'enriched'`

## Known issues
- Some Google Maps photo URLs are short-lived signed URLs — they may 403 by the time we fetch them. Re-run stage 2 to regenerate.

## Future
- Plug in an email-finder (Hunter `/email-finder` endpoint) in this stage.
- Optional: extract a secondary accent color via k-means.
