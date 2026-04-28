# Deployment

## What gets deployed where

| Component | Target | How |
|-----------|--------|-----|
| Generated demo sites | Cloudflare Pages (one project per site) | `web/lib/services/cloudflare-pages.ts` |
| Web app (dashboard + API) | Vercel (recommended) or Cloudflare Pages | `next build` + platform default |
| Pipeline runner | Long-lived Node process (VPS / a Fly machine / Cloudflare Workers cron) | `npm run run:batch` from a worker |
| Database | Supabase (managed) | already deployed once schema is applied |

## Web app deploy

```bash
cd web
npm run build           # outputs .next/
# Vercel: `vercel --prod` (or push to a Vercel-connected repo)
# Self-hosted: `npm start` behind a reverse proxy
```

If you go with Vercel: connect this repo, set the **Root Directory** to `web/`, and add every `.env` value as a Vercel env var (server-only — do NOT prefix with `NEXT_PUBLIC_`).

## Pipeline runner deploy

Two options:

### Option A — operator-triggered (pilot)
Run from your laptop. Open a terminal:
```bash
cd web
npm run run:batch -- --niche=plumber --city="Austin, TX" --scraper=google_places --limit=60
```
Acceptable for the first dozen batches.

### Option B — long-lived worker (post-pilot)
Tiny Fly.io machine or Cloudflare Worker (cron) that polls for `batches.status='queued'` and calls `runBatch(id)`. The interface is already factored — only the trigger changes.

For higher reliability, swap to **Inngest**: durable retries, observability, and free tier covers the pilot. The pipeline functions stay the same; you wrap `runBatch` in an Inngest function.

## Database

Schema lives in `db/schema.sql`. Apply once:
```bash
psql "$SUPABASE_URL" -f db/schema.sql
```

For schema changes, write a numbered migration in `db/migrations/` and update `schema.sql` to the new state.

## Generated sites

Each site is its own Cloudflare Pages project named `<lead-slug>`. Created on first deploy (`ensureProject`) and updated on subsequent deploys.

Domains:
- Default: `<slug>.pages.dev`
- After custom domain wiring: `<slug>.<root>` (e.g. `joes-plumbing.demo.optinetsolutions.com`)

## Secrets

Never commit:
- `.env`
- `credentials.json`
- `token.json`

Rotate any key that has been written to a public commit immediately.

## Policy

- Never auto-push or auto-deploy from Claude. Output the command for the operator to run.
- Production deploys go through manual approval.
- DB migrations are applied by hand against staging first, then production after a 24h soak.
