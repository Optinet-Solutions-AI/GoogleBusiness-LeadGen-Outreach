# Workflow — Generate a demo site (stage 3)

**Objective:** Build one personalized static site for a lead, using the configured Astro template + Claude-generated copy.

## Inputs
- `lead` at `stage = 'enriched'`
- `batch.template_slug` — folder under `templates/`

## Tool
- `web/lib/pipeline/stage-3-generate.ts`
  - calls `lib/services/gemini.ts` for hero/about/services/service-area copy (multi-page)
  - writes `templates/<slug>/src/data.json`
  - shells out: `npm install` (first run only) then `npm run build` in that template
  - copies `dist/` → `.tmp/generated-sites/<lead-slug>/dist/`

## Expected Outputs
- A `.tmp/generated-sites/<lead-slug>/dist/index.html` ready to deploy
- `lead.stage = 'generated'`

## Cost
Gemini 2.5 Flash — free tier covers ~1,500 sites/day. Watch the daily quota for huge batches; otherwise zero variable cost.

## Known issues
- `npm install` is slow on first run; cache `node_modules` per template (already handled — only installed when missing).
- Claude very rarely returns prose around the JSON object. The current parser will raise — fix by making the prompt stricter or adding a JSON-extraction fallback.
- If `data.json` fields are missing, the Astro template falls back to safe defaults; do **not** fail the build because copy is thin.

## Lessons learned
- Cache the system prompt with `cache_control: ephemeral` — saves ~70% of input tokens across a batch.
