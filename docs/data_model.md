# Data Model

Authoritative schema: [`db/schema.sql`](../db/schema.sql).

This file explains *why* each column exists and how it's used by the pipeline.

## `batches` — one per pipeline run

| Column | Why |
|--------|-----|
| `niche` | Determines the scraper query and which template is used. |
| `city` | Scraper query. |
| `template_slug` | Selects which `templates/<slug>/` is the build target. |
| `scraper` | Picks the stage-1 provider: `google_places` (default) or `outscraper`. |
| `limit` | Max leads to scrape (cost cap). Truncated by per-scraper cap if larger. |
| `estimated_cost_usd` | Cost preview at create time (from `lib/pricing.ts`). |
| `status` | `queued` → `running` → `done` / `failed`. Set by the orchestrator. |

## `leads` — one per business

| Column | Set by | Read by |
|--------|--------|---------|
| `business_name`, `phone`, `address`, `category`, `rating`, `review_count`, `has_website`, `place_id`, `latitude`, `longitude`, `photos`, `reviews` | stage 1 (Google Places or Outscraper) | filters; stage 3 (template data); operator UI |
| `email` | stage 2 (email finder, TBD) or operator hand-edit | stage 5 (outreach) |
| `brand_color` | stage 2 (color extractor); operator override on improve | stage 3 (template data) |
| `service_areas` | operator on improve | stage 3 (Service Area page) |
| `business_hours` | operator on improve | stage 3 (Footer + Contact page) |
| `stage` | every stage updates its successor | orchestrator (loop control), API filters |
| `demo_url` | stage 4 (Cloudflare) | stage 5 (email body), operator UI |
| `custom_domain` | handover (`attach` mode) | dashboard, downstream comms |
| `handover_mode` | handover (`attach` or `transfer`) | reporting |
| `notes` | operator on meeting / improve | dashboard timeline |
| `last_error` | every stage on failure | operator UI for triage |

The `(place_id, batch_id)` unique constraint is critical: it lets stage 1 re-run safely after a partial scrape.

## `outreach_events` — append-only log

Every interaction with a lead — email sent, opened, replied, call made — writes one row here. Never update; insert only.

`kind` values seen so far:
- `email_sent` — written by stage 5
- `email_opened` — written by Instantly webhook
- `replied` — written by Instantly webhook (also flips `lead.stage` to `replied`)
- `email_bounced` — written by Instantly webhook
- `call_made` — written by operator (manual)

## `lead.stage` enum (and what each means)

| Stage | Meaning | Owner |
|-------|---------|-------|
| `scraped` | row exists, qualified, raw fields populated | stage 1 |
| `enriched` | brand_color set; email set or known-missing | stage 2 |
| `generated` | dist/ exists on disk | stage 3 |
| `deployed` | demo_url is live (`<slug>.pages.dev`) | stage 4 |
| `outreached` | added to Instantly campaign | stage 5 |
| `needs_email` | deployed but no email — operator must supply | stage 5 |
| `replied` | prospect responded to outreach | webhook |
| `meeting_booked` | call/meeting scheduled | `POST /api/leads/:id/meeting` |
| `meeting_done` | meeting happened; awaiting next step | `POST /api/leads/:id/meeting` |
| `improved` | rebuilt with customer-supplied photos/copy/hours | `POST /api/leads/:id/improve` |
| `handed_over` | custom domain attached or project transferred | `POST /api/leads/:id/handover` |
| `closed_won` | paying (set after Stripe subscription clears) | operator / Stripe webhook (later) |
| `closed_lost` | said no after meeting | operator |
| `dead` | not interested or unreachable after sequence | operator |

The frontend filters and orchestrator branching depend on these exact strings — don't add new values without updating both.
