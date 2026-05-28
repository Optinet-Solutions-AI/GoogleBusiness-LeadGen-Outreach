# Site Audit — `e9fc7566-a0e5-48da-bd1e-a0aee99efc61`

## Lead resolved

| Field | Value |
|---|---|
| Lead ID | `e9fc7566-a0e5-48da-bd1e-a0aee99efc61` |
| Business | The Little Things \| Balloon Garlands & Event Styling Hamilton |
| Demo URL | https://181bdf65.the-little-things-balloon-garlands-event.pages.dev |
| Stage | `generated` |
| Niche | event-services |
| Category (raw) | `home_goods_store` |
| City | Frankton, Hamilton |
| Brand color (DB) | `#CE6986` (deep rose) |
| Brand color (deployed) | `#F0D9D9` (pale pink) — mismatch |
| Logo | data URI (good, no expired CDN) |
| Rating / reviews | 4.2 / 5 |

DB lookup pulled the demo URL directly — operator never asked for it.

## Punch list

| # | Issue | Severity | Where it shows | Fix location | Status |
|---|---|---|---|---|---|
| 1 | Raw Google category slug `HOME_GOODS_STORE` rendered in hero eyebrow | high | Hero, first eyebrow row (mobile + desktop, top-of-page) | `templates/premium-trades/src/components/hero/editorial-split.tsx` — current source already drops `data.category`. Deployed bundle is stale (predates commit `467eef1`). Rebuild + redeploy. | Rebuild required |
| 2 | Hero rating chip (5 stars + "4.2 · 5 verified reviews") duplicates dedicated reviews section | medium | Right side of hero eyebrow row, both viewports | Same file (`editorial-split.tsx`). Already removed in source — same stale-bundle issue as #1. | Rebuild required |
| 3 | Brand color drift — DB says `#CE6986`, deployed palette is `#F0D9D9` | medium | All accents (eyebrow color, headline underline, CTA hover) read pastel instead of saturated rose | `web/lib/pipeline/stage-3-generate.ts` palette injection. Photo-extracted palette overrode DB `brand_color`. Lock to DB `brand_color` or re-run stage-3. | Needs your call |
| 4 | Duplicate testimonials — same 3 authors (Sarah M., David L., Jessica P.) shown twice in the reviews strip | medium | `#reviews` section — `variants.reviews === "marquee"` with only 3 usable reviews, marquee duplicates them | `web/lib/pipeline/stage-3-generate.ts:222` — clamp exists (`usableReviewCount < 6 → masonry-grid`) but didn't fire for this lead. Re-run stage-3. | Needs re-run of stage-3 |
| 5 | Hero text passes behind opaque sticky header | medium | Desktop scrolled view — "Locally owned in Frankton." overlay sits flush with header bar; no visual gap | `templates/premium-trades/src/components/Header.astro` — `data-opaque-on-scroll` script bg toggle may not be firing for this build. | Needs your call |
| 6 | Header mobile brand uses long form ("Balloon Garlands & Event Styling Hamilton") at 390px | low | Mobile top — title wraps to 2 lines | `Header.astro:39` — `shortName` should be tighter ("The Little Things"). Check `shortName` derivation in `lib/pipeline/stage-3-generate.ts`. | Needs your call |

## Negative findings (confirmed NOT present)

- No fbcdn / cdninstagram expired URLs (logo persisted as data URI ✓)
- No `31 78 121` navy fallback palette (pink palette is in use, just the wrong shade)
- Title and `<h1>` render server-side ("Transforming Your Celebrations into Unforgettable Moments") — no JS-only render
- No sticky CTA bar visible on mobile scrolled view

## Root cause summary

Two of the three highest-severity findings (raw category slug, hero rating chip) are both fixed in the current `main` branch (commit `467eef1` — "fix(template): drop category + rating chip from ALL six hero variants"). The deployed Cloudflare Pages bundle is older than that commit. The site needs to be rebuilt against current template sources and redeployed.

The brand-color mismatch and duplicate testimonials are independent bugs that the rebuild won't fix on its own — both require a stage-3 re-run for this lead (which will also re-bake the palette from `brand_color` and re-clamp the reviews variant).

## Recommended next steps (operator action)

1. Re-run stage-3 for this lead (`POST /api/leads/{id}/regenerate` from stage 3) — fixes #3 and #4 and pulls in current hero variants for #1 and #2.
2. Re-run stage-4 to redeploy.
3. Re-audit served HTML and confirm `home_goods_store` and the rating chip are gone from the hero.

Do not redeploy without operator approval — Cloudflare Pages deploys count against the project's daily build quota and ScrapingBee/Gemini may re-run on regenerate.
