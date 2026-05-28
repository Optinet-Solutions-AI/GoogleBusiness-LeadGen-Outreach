# Site Audit — The Little Things | Balloon Garlands & Event Styling Hamilton

- **Lead ID:** `e9fc7566-a0e5-48da-bd1e-a0aee99efc61`
- **Demo URL:** https://181bdf65.the-little-things-balloon-garlands-event.pages.dev
- **Stage:** `generated`
- **DB brand color:** `#CE6986` (rose)
- **Deployed primary:** `#F0D9D9` (pale pink — AI palette is overriding the logo color)
- **Active variants:** hero=`editorial-split`, services=`photo-cards`, reviews=`marquee`, trust=`animated-strip`, service_area=`styled-list`, cta=`sticky-bar`

Screenshots: `mobile_top.png`, `mobile_scrolled.png`, `desktop_top.png`, `desktop_scrolled.png` (in this folder).
Programmatic results: `audit.json`. Served HTML: `served.html`.

---

## Headline finding

**The deployed bundle is stale.** Three of the visible defects (raw category slug, hero rating chip, sticky CTA visible on mobile) are all already FIXED in the template source on disk — but the JS bundles served from Cloudflare Pages still contain the older code. This site was generated before those template fixes shipped to the deployed dist.

A single rebuild + redeploy of this lead resolves the three medium findings together. No source edits required.

---

## Punch list

| # | Issue | Severity | Where it shows | Fix location | Status |
|---|---|---|---|---|---|
| 1 | Raw Google category slug `HOME_GOODS_STORE` in hero eyebrow | medium | `mobile_top` (top-left, under header). Inside data-island JSON on desktop. | Source `templates/premium-trades/src/components/hero/editorial-split.tsx` already drops `data.category`. Deployed `editorial-split.DTJMwqZx.js` is the old bundle. | **Needs operator call** — rebuild + redeploy. |
| 2 | Floating rating chip (4.2 · 5 verified reviews) in hero | medium | `mobile_top` (right under category slug) | Same stale `editorial-split.DTJMwqZx.js` bundle. Source already removed the chip. | **Needs operator call** — same rebuild + redeploy as #1. |
| 3 | Sticky CTA bar visible on mobile (< 640 px) | medium | `mobile_scrolled` — "Book your date with confidence" bar floating at the bottom | Source `templates/premium-trades/src/components/cta/sticky-bar.tsx` has `hidden sm:block` on the root container. Deployed `sticky-bar.AI99Rs1O.js` is missing that class — old bundle. | **Needs operator call** — same rebuild + redeploy. |
| 4 | AI palette overrides DB `brand_color` | low | All screenshots — buttons + accents are pale pink `#F0D9D9` instead of the rose `#CE6986` from the DB | Stage-2 enrich / palette generator: Gemini-suggested palette is winning over the logo-derived swatch from the DB. | **Judgment call** — see Option A below. |
| 5 | Header brand text wraps to 2 lines + crowds the CTA pill on mobile | low | `mobile_top` — "Balloon Garlands & Event Styling Hamilton" stacks over two lines; `Plan My Event` button is jammed against the right edge | `templates/premium-trades/src/components/Header.astro` — the long-brand fallback could shorten via a `data.short_name` field or hide the suffix on small screens | **Judgment call** — see Option B below. |

No high-severity findings (no fallback navy palette, no expired social-CDN logos, no empty render). Logo is correctly persisted as a `data:image/jpeg;base64` URI.

---

## High-confidence fixes applied automatically

**None.** All three medium findings are caused by a stale deployed bundle, not by a source-code defect. The skill explicitly states it does not redeploy, so I'm surfacing the call rather than triggering it.

The mechanical work, when you're ready to take it, is roughly:

```
cd templates/premium-trades && npm run build
# then re-run stage-4 for this lead, or trigger the Cloud Run job
NODE_PATH=web/node_modules npx tsx web/scripts/run-batch.ts --lead=e9fc7566-a0e5-48da-bd1e-a0aee99efc61 --from-stage=4
```

I have not run either of those.

---

## Judgment calls for you

### Option A — Brand color: AI palette is winning over `#CE6986`

The DB has `brand_color: "#CE6986"` (saturated rose) but the deployed page uses Gemini's `#F0D9D9` (pale pink) as primary. Pale pink reads pleasant for the niche but diverges from the logo color and washes out the CTA pill on the cream hero.

1. Keep the AI palette. It reads on-brand for balloon-garland work.
2. Force the logo-derived `#CE6986` for this lead — edit the lead's palette or pin `palette.primary = brand_color` in stage-2 for this niche, then regenerate.
3. Investigate the override globally. If AI palettes regularly overrule logo-derived swatches, that's a stage-2 design decision worth a separate writeup before changing per-lead.

### Option B — Header brand on mobile is too long

Current header renders "The Little Things | Balloon Garlands & Event Styling Hamilton" — wraps to two lines on 390 px and crowds the CTA pill.

1. Truncate at the pipe — show "The Little Things" on `<sm`, full name from `sm` up. Requires Header.astro to split on `|`.
2. Add a `short_name` field to the lead schema and let Gemini / a regex pick a short version per lead.
3. Leave it — wrap is ugly but not broken. CTA still fits.

---

## Suggested next action

Rebuild + redeploy this single lead (no source edits needed) to clear items 1–3 in one shot, then come back to A and B as design decisions.
