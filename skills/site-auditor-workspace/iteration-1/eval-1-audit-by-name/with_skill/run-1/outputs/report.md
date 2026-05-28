# Site audit — The Little Things (Balloon Garlands & Event Styling, Hamilton/Frankton)

**URL audited:** https://181bdf65.the-little-things-balloon-garlands-event.pages.dev
**Date:** 2026-05-28
**Hero variant in play:** `editorial-split` (photo on right, headline + CTA stack on left)
**Lead data signals:** `category = "home_goods_store"`, `rating = 4.2`, `review_count = 5`, `logo_url` correctly persisted as `data:image/jpeg;base64,...`, hero photos are Unsplash stock placeholders (no real business photos), brand color appears non-fallback (no navy in served HTML).

---

## Punch list

| # | Issue | Severity | Where it shows | Fix location | Status |
|---|---|---|---|---|---|
| 1 | Raw Google category slug `HOME_GOODS_STORE` rendered in hero eyebrow | medium | `mobile_top.png` (eyebrow row: "HOME_GOODS_STORE  FRANKTON"); 5 occurrences in served HTML | Drop `data.category` from `editorial-split` hero's eyebrow JSX in `templates/premium-trades/src/components/hero/` — keep just the city pill | will auto-fix (mechanical, same pattern across all 6 hero variants per known-issues.md) |
| 2 | Floating rating chip in hero (`★★★★★ 4.2 · 5 verified reviews`) | medium | `desktop_top.png` (chip overlaid bottom-left of hero photo) and `mobile_top.png` (stars + 4.2 in eyebrow row, above headline) | Remove the rating block from the active `editorial-split` hero variant — reviews section + JSON-LD `aggregateRating` already carry the signal | will auto-fix |
| 3 | Sticky-bar CTA bleeding into mobile viewport | medium | `mobile_scrolled.png` — dark "Book your date with confide…" bar visible at very bottom right edge; same bar dominates `desktop_scrolled.png` bottom strip (fine on desktop, NOT on mobile) | `templates/premium-trades/src/components/cta/sticky-bar.tsx` — outermost wrapper needs `hidden sm:block` so it's desktop-only. Served HTML shows `sticky-bar.AI99Rs1O.js` is hydrating on mobile | will auto-fix |
| 4 | Mobile header isn't going opaque on scroll — hero photo bleeds through | medium | `mobile_scrolled.png` — the brand text "Balloon Garlands & Event Styling Hamilton" sits over the hero photo and the photo is clearly visible behind it (no opaque band) | `Header.astro` — `data-opaque-on-scroll` script should toggle `bg-surface/85 → bg-surface` once `scrollY > 24`. Served HTML has `sticky top-0 transition-all z-40` but the opaque-swap may not be firing on mobile | needs your call — likely a JS event-binding issue, want to confirm with a desktop check before patching |
| 5 | Mobile header brand text wraps onto two lines AND collides with hero | medium | `mobile_top.png` — "Balloon Garlands & Event Styling" on line 1, "Hamilton" on line 2 next to the "Plan My Event" pill, eating ~50% of vertical hero area | `Header.astro` short-brand fallback. Business name has no clean pipe/dash separator past "The Little Things \| Balloon Garlands & Event Styling Hamilton" — the post-pipe segment is itself 44 chars, still too long. Options: (a) parse to just "The Little Things" on mobile, or (b) force ellipsis when post-pipe > 28 chars | needs your call — option (a) loses niche keywords; option (b) is uglier but keeps the words. Recommend (a) on mobile only |
| 6 | Trust-strip cards on mobile render as transparent ghosted pills | medium | `mobile_scrolled.png` — "Custom Designs for Every Theme" and "Joyful Event Experiences" appear as low-contrast outlined chips with no fill, against the section background. Looks broken | Likely the trust-strip uses `bg-surface/40` or similar low-opacity bg that bleeds against the section panel on mobile. Check `templates/premium-trades/src/components/trust-strip/*` and bump mobile opacity to `bg-surface/90` or solid | needs your call — could be intentional "minimalist" styling; worth a screenshot diff against a desktop reference before patching |
| 7 | Hero photos are Unsplash stock, not the business's real work | low (data) | `desktop_top.png` and `mobile_top.png` — generic balloon-arch + venue photos that don't match the business's actual style | Not a template bug. Photos come from `data.photos` which got Unsplash defaults because Google Places didn't return business photos for this lead. To fix, either (a) re-run stage-1 with `places.photos` requested, or (b) flag as "needs real photos" for the post-reply `improve` stage | out of scope for this skill (data + scraper-stage issue, not template) |
| 8 | "FRANKTON" eyebrow + "Locally owned in Frankton" overlay both fire | low | `desktop_top.png` shows both — eyebrow row has "FRANKTON" pill, and photo bottom-left card says "Locally owned in Frankton." Three Frankton mentions above the fold (incl. headline subhead) is repetitive | Pick one location signal in the hero. Will be partially resolved by Fix #1; recommend keeping `Locally owned in Frankton` overlay and dropping the eyebrow city pill | partially resolved by Fix #1 |

---

## What's NOT broken (verified)

- Palette is correct — no fallback navy (`31 78 121`) in served CSS. Brand color injection working.
- Logo is persisted as a base64 data URI — no fbcdn/cdninstagram expiry risk.
- Reviews section has 3 distinct testimonial authors (Sarah M., David L., Jessica P.) — stage-3 clamp picked the right variant for the low review count (5). No duplicates.
- Render is not JS-only. Served HTML has full `<title>` ("Home — The Little Things | Balloon Garlands & Event Styling Hamilton") and `<h1>` content (57 chars).
- Service cards on desktop look fine — title + description visible, hover state implied.

---

## Recommended next step

Apply the three mechanical fixes (#1, #2, #3) in one edit pass, run `cd templates/premium-trades && npm run build` to confirm clean compile, then re-screenshot. After that, surface #4, #5, #6 as judgment calls — they all involve either intent ambiguity (intentional minimalism vs. bug) or copy/branding trade-offs you should own.

Issues #7 (stock photos) and #8 (location repetition) are downstream of data + copy decisions; flag for the `improve` workflow once the prospect engages.

---

## Artifacts (in this folder)

- `audit.json` — raw output from `audit-site.ts`
- `served.html` — full HTML as served by Cloudflare Pages
- `desktop_top.png` / `desktop_scrolled.png` — 1440px viewport
- `mobile_top.png` / `mobile_scrolled.png` — 390px viewport
