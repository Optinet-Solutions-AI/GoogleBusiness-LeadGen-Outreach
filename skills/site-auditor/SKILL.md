---
name: site-auditor
description: Audit a generated lead-gen demo site for visual + structural anti-patterns. Use whenever the operator pastes a `pages.dev` URL, says "audit this site", "review the demo", "what's wrong with this site", or names a lead whose demo looks off. Also use when investigating reports like "the logo is wrong", "theme doesn't match", "mobile is cut off", "broken image", or "site looks like a plumber template" — these all map to known anti-patterns this auditor catches. Reports a punch list with file paths, applies high-confidence fixes automatically, pauses for judgment calls.
---

# site-auditor

## When invoked

The operator gives you ONE of:
- A deployed URL (`https://<hash>.<slug>.pages.dev` or any URL)
- A lead UUID
- A business-name fragment ("the little things", "joe's plumbing")

Resolve to a URL first, then audit.

## Workflow

### 1. Resolve input to a URL

If input is a URL → use it directly.

Otherwise → look up the lead via `scripts/lookup-lead.ts` (takes a UUID or a name fragment, returns `{ id, business_name, demo_url, logo_url, brand_color }`):

```bash
NODE_PATH=web/node_modules npx tsx skills/site-auditor/scripts/lookup-lead.ts "<id-or-name>"
```
(`NODE_PATH` points at `web/node_modules` so `@supabase/supabase-js` + `dotenv` resolve. Run from the repo root.)

If the lookup returns no `demo_url`, tell the operator the lead hasn't been deployed yet and stop — there's nothing to audit.

### 2. Capture served HTML + screenshots

```bash
NODE_PATH=web/node_modules npx tsx skills/site-auditor/scripts/audit-site.ts <demo_url>
```
(Same `NODE_PATH` pattern — script spawns Playwright via `web/`'s node_modules.)

This script does the heavy lifting in one pass:
- `curl`s the HTML to `/tmp/audit/served.html`
- Spawns Playwright, takes 4 screenshots: `mobile_top.png`, `mobile_scrolled.png`, `desktop_top.png`, `desktop_scrolled.png`
- Returns a JSON blob with all the programmatic checks (see below)

Read each screenshot via the `Read` tool to inspect visually — the script handles the programmatic checks but humans (and Claude) need to *see* the page to catch layout/proportional issues the regex grep can't.

### 3. Run anti-pattern checks

The script already returns these as JSON. Map each finding to a fix location in this codebase. Severity matters — `high` is broken, `medium` is messy, `low` is cosmetic.

### Programmatic checks (audit-site.ts already emits these)

| Check | How it's detected | Severity | Where to fix |
|---|---|---|---|
| `fallback_navy_palette` | Regex: `--c-primary:31 78 121` in served HTML | high | Palette injection order. See [references/known-issues.md](references/known-issues.md#palette). |
| `expired_social_cdn_logo` | Regex: `src=...fbcdn.net/` or `cdninstagram.com/v/` | high | Logos must be persisted as `data:image/jpeg;base64,...` URIs (`web/lib/services/logo.ts`). |
| `raw_google_category_slug` | Regex: snake_case slug between tags (`>home_goods_store<`) | medium | Drop `data.category` from the active hero variant's eyebrow. |
| `hero_rating_chip` | Regex: 1-decimal rating + "verified" / "reviews" within ~400 chars | medium | Remove the rating block from the active hero variant. |
| `duplicate_testimonial_authors` | Same `data-author` attribute appearing 2+ times | medium | `web/lib/pipeline/stage-3-generate.ts` clamps `variants.reviews` based on `usableReviewCount`. |
| `empty_render` | Title/H1 missing or short — likely build failure | high | Astro build failed OR stale dist was deployed. Re-run stage-3 + stage-4. |
| `eyebrow_category_leak` | **DOM check**: leading eyebrow token is snake_case OR a single bare lowercase word (≥5 chars). Catches `CONSULTANT` / `PLUMBER` that the regex misses. | medium | Drop `data.category` from the hero variant's eyebrow JSX. |
| `mobile_header_overflow` | **DOM check**: brand `<a>` rendered height > 1.6 × line-height at 390px (= multi-line wrap) | medium | `Header.astro` short-brand parser — this lead's parsed segment is still too long. Consider a tighter char cap. |
| `cta_brand_color_mismatch` | **DOM check**: header pill background-color RGB differs from `--c-primary` by >24 per channel | high | Stale bundle OR a component using a hardcoded color rather than the CSS var. |
| `hero_rating_chip_v2` | **DOM check**: H1's section contains both a 1-decimal rating AND any of (reviews / locally owned / google / "in X city") OR star icons | medium | Remove rating block from the active hero variant. |

### Screenshot-only checks (verify by reading the PNG)

| Check | Where to look | Severity | Where to fix |
|---|---|---|---|
| **Sticky CTA on mobile** | floating bar visible at bottom of `mobile_scrolled` | medium | `cta/sticky-bar.tsx` — should be `hidden sm:block`. |
| **Hero text behind sticky header** | top of headline obscured at `mobile_scrolled` or `desktop_scrolled` | medium | `Header.astro` — `data-opaque-on-scroll` script. bg toggles `bg-surface/85 → bg-surface` once `scrollY > 24`. |
| **Logo too small on mobile** | logo looks favicon-sized next to CTA pill | low | `Header.astro` logo size — should be `w-10 h-10` below sm. |
| **Broken image** | placeholder / 404 image visible anywhere | medium | Inspect `data.photos[]` values; may be expired CDN URLs (covered by `expired_social_cdn_logo`) or Unsplash 404s. |

### 4. Report the punch list

Output a markdown table with: Issue · Severity · Where it shows · Fix location · Status (will auto-fix / needs your call).

Be honest about confidence. Auto-fix only the items where the fix is mechanical and the right answer is obvious from the codebase (e.g., a known import drift in one of the 6 hero variants where the other 5 already match the new pattern). For anything involving a creative choice (which hero variant to pick, copy rewrites, layout restructuring), surface the option and let the operator decide.

### 5. Apply high-confidence fixes

For each high-confidence finding:
1. Locate the file (the table above is the map)
2. Make the edit
3. Run `cd templates/premium-trades && npm run build` to confirm it compiles
4. Re-screenshot and verify the issue is gone

Don't commit. Group all edits, show the diff to the operator, let them decide whether to commit + redeploy.

### 6. For judgment calls, present options

Wrap each judgment call in an `AskUserQuestion` with 2-3 concrete options. Examples:
- "Hero variant `full-bleed-photo` makes the headline hard to read on this photo. Switch to `editorial-split`?"
- "Testimonials section has 3 reviews and Gemini picked `marquee`. Switch to `masonry-grid` for this lead?"
- "Brand color `#CE6986` is being overridden by AI's palette. Lock to logo-derived palette permanently for this lead?"

## What this skill does NOT do

- Doesn't redeploy. Pushing to origin/main and re-running Cloud Run jobs are operator decisions — they cost time and ScrapingBee credits.
- Doesn't regenerate copy. If the issue is the copy itself (typos, wrong tone), use the `site-generator` skill or run stage-3 directly.
- Doesn't audit non-template issues (database, scraping, deploy infrastructure). Stay scoped to the rendered site.

## Why this exists

Auto-generated sites for hundreds of leads will inevitably ship anti-patterns the template author didn't anticipate, especially as Gemini picks different variants per lead. Most of them are mechanical — same broken pattern across many leads — so a regex + screenshot audit catches them in 30 seconds instead of an operator scrolling through one site at a time. The judgment calls are where the operator's time is well spent; everything else is automation.

See [references/known-issues.md](references/known-issues.md) for the recurring bugs we've encountered and the root-cause analysis behind each fix in the table above.
