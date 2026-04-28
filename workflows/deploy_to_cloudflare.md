# Workflow — Deploy a site (stage 4)

**Objective:** Push a built site to Cloudflare Pages and capture the live URL.

## Inputs
- `lead` at `stage = 'generated'`
- `.tmp/generated-sites/<slug>/dist/` exists

## Tool
- `web/lib/pipeline/stage-4-deploy.ts` → `lib/services/cloudflare-pages.ts`

## Steps
1. `ensureProject(slug)` — POST creates the Cloudflare Pages project (idempotent: 409 = already exists).
2. `deploy(slug, distDir)` — multipart upload of every file under `dist/`.
3. Update `lead.demo_url` and `lead.stage = 'deployed'`.

## Expected Outputs
- Live URL on `<slug>.pages.dev` (or `<slug>.<root>` once a custom root domain is wired).

## Known issues
- Cloudflare API limits ~1200 deployments per 5 minutes per token. For batches over ~200 sites, sleep between deploys or shard tokens.
- 429 responses are retried by `lib/retry.ts`; persistent 429 = back off the orchestrator concurrency.

## Future
- Wire a single root domain (e.g. `demo.optinetsolutions.com`) and use Pages' "custom domain on subdomain" feature so URLs look professional.
