# Local Lead-Gen & Auto-Site Pipeline

Scrape Google Maps for local businesses without websites → auto-generate a personalized demo site for each → deploy to Cloudflare Pages → email the link → close.

> **Read [`CLAUDE.md`](./CLAUDE.md) first.** That's the architecture and the rules.

---

## Quick start

### 1. Prerequisites
- Node.js 20+
- A Supabase project (free tier is fine)
- API keys: at minimum `GOOGLE_PLACES_API_KEY` (Google Cloud) for the pilot — Anthropic, Cloudflare, and Instantly come online as you wire each stage.

### 2. Configure
```bash
cp .env.example .env
# fill in real values (or leave blank — the /api/pricing/* endpoints work without any keys)
```

### 3. Install + run the app
```bash
cd web
npm install
npm run dev      # http://localhost:3000
```

You'll see the placeholder dashboard. The API is live at `/api/*` — try:
- http://localhost:3000/api/health
- http://localhost:3000/api/pricing/compare?limit=100

### 4. Apply DB schema (when you're ready to actually run batches)
```bash
psql "$SUPABASE_URL" -f db/schema.sql
```

### 5. Run a real pipeline batch
```bash
cd web
npm run run:batch -- --niche=plumber --city="Austin, TX" --scraper=google_places --limit=60
```

This is the **CLI** entrypoint. Don't trigger long batches from the HTTP API — serverless timeouts will kill them. See [`web/README.md`](./web/README.md) for details.

---

## What lives where

| Folder | Purpose |
|--------|---------|
| `web/` | Next.js app — dashboard pages, API routes, pipeline modules |
| `db/` | Schema + migrations (language-agnostic SQL) |
| `templates/` | Astro site templates, one per niche |
| `workflows/` | Markdown SOPs — read these before writing code |
| `skills/` | Claude Code skills you can invoke with `/<name>` |
| `docs/` | Architecture, decisions, weekly status |
| `.tmp/` | Scratch space (gitignored, regenerated freely) |

Full breakdown: see [`CLAUDE.md`](./CLAUDE.md#directory-structure).

---

## Status

Weekly progress is tracked in [`docs/status/`](./docs/status/) — one file per ISO week (e.g. `2026-W17.md`).
