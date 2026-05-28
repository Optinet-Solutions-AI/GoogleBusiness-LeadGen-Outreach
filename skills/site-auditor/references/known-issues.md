# Known issues + root-cause notes

These are the recurring anti-patterns the auditor watches for, with the root-cause analysis behind each fix. Read the relevant section when a finding shows up — it explains *why* the obvious-looking fix is the right one and what NOT to do.

## Palette

**Symptom:** Served CSS has `--c-primary: 31 78 121` (FALLBACK_HEX navy) even though the lead's `brand_color` in Supabase is the real logo-derived hex.

**Why it happens:** `global.css :root` originally had hardcoded navy defaults. Astro bundles that stylesheet into a generated CSS file that gets injected into the final HTML *after* the inline `<style is:global>` from `Base.astro`. Two selectors with the same specificity (both `:root`) — source order wins, so global.css's defaults re-override the per-build palette.

**Fix:** `templates/premium-trades/src/styles/global.css` — the `:root { ... }` block at the top must NOT declare `--c-primary` / `--c-accent` / etc. Defaults belong in `Base.astro`'s `hexToTriplet()` fallback string, where the inline injection is the only source of truth.

**Don't:** Add `!important` to the inline override. The right fix is to remove the conflicting rule, not stack hacks on top of it.

## Logo expiry (fbcdn / cdninstagram)

**Symptom:** Served HTML has `<img src="https://scontent.*.fbcdn.net/v/t39.30808-1/...?oh=...&oe=...">`. Image renders broken in browser when `oe` (unix-hex expiry) has passed — typically 3-4 weeks after issue.

**Why it happens:** FB/IG sign their CDN URLs with a time-bound `oh` signature and an `oe` expiry. Caching the URL in `lead.logo_url` and embedding it directly in static HTML means every deployed site breaks ~3 weeks after the rebuild.

**Fix:** Logos sourced from FB/IG must be downloaded at stage-2 time and persisted as `data:image/jpeg;base64,...` URIs. See `web/lib/services/image-fetch.ts` and the data-URI branch in `web/lib/services/logo.ts`. If the audit finds an expired URL on a deployed site, the lead row also has it cached — clear with `?refresh-socials=1` regenerate.

## Raw Google taxonomy slugs

**Symptom:** Visible text on the page like `HOME_GOODS_STORE`, `PARTY_SUPPLIES_BUSINESS`, `PLUMBING_SERVICE_CONTRACTOR`.

**Why it happens:** Google Places returns the business category as a machine-formatted slug. Several hero variants used to render `data.category` directly in the eyebrow row.

**Fix:** All six hero variants in `templates/premium-trades/src/components/hero/` should drop `data.category` from visible JSX. Replace with just the city (parsed from `data.address`). The category still lives in JSON-LD schema in `Base.astro` for SEO.

## Floating rating chip in hero

**Symptom:** Hero section has a "★★★★★ 4.2 · Locally owned in Frankton" chip floating somewhere — over the photo, in the headline area, or as a glass card.

**Why it happens:** Each hero variant has its own rating display. For low-review-count businesses (Google Places returns rating + count, often 5-15 reviews), the chip reads as small/thin rather than as social proof.

**Fix:** Removed from all six variants. The dedicated reviews section carries the signal, and Google's auto-snippets pull `aggregateRating` from JSON-LD independently. If a new variant gets added later and renders a rating chip, this anti-pattern reappears — flag it.

## Duplicate testimonial authors

**Symptom:** The reviews section shows the same author's testimonial 2+ times.

**Why it happens:** `marquee.tsx` deliberately doubles (now triples) the cards for animation loop continuity. With low review counts (<6 unique), the duplicates land in the visible viewport.

**Fix:** Stage-3 (`web/lib/pipeline/stage-3-generate.ts`) clamps `variants.reviews` against `usableReviewCount`: <3 → `single-featured`, 3-5 → `masonry-grid`, ≥6 → keep AI's choice (typically `marquee`). If duplicates are showing on a deployed site, stage-3 wasn't re-run for this lead after the clamp landed.

## Mobile header truncation

**Symptom:** Mobile header at 390px shows "The Little Thi..." or similar ellipsis on the brand text.

**Why it happens:** Google Business names regularly bake niche + city into the display name. On a sticky header with logo + pill CTA + brand text, the available width for the text isn't enough to render the full Google name OR the post-separator short brand.

**Fix:** `templates/premium-trades/src/components/Header.astro` — short-brand at `text-sm` on mobile, `text-base` at sm, full name at lg+. If the lead's `business_name` has no pipe/dash separator AND is over 22 chars, we still truncate with an ellipsis (better than overflowing).

## Sticky CTA on mobile

**Symptom:** Floating dark bar with phone + CTA at bottom of mobile scroll position, overlapping service-card content.

**Why it happens:** `sticky-bar.tsx` `cta` variant was rendering on all viewports. Below sm, the phone link is already in the header pill + hero + "Ready to talk" section — fourth placement was overkill and visually conflicting.

**Fix:** `templates/premium-trades/src/components/cta/sticky-bar.tsx` — outermost container has `hidden sm:block`. If a new sticky CTA variant gets added, propagate the same gate.

## Hero text behind sticky header on scroll

**Symptom:** Top of hero headline visibly bleeds through / is clipped by the sticky header when scrolled past the top of page.

**Why it happens:** Header was `bg-surface/85` (15% transparent) + `backdrop-blur`. Looks great at scrollY=0, but as the headline scrolls into the header band, large serif glyphs visibly leak through.

**Fix:** `Header.astro` — `data-opaque-on-scroll` script toggles `bg-surface/85 → bg-surface` once `scrollY > 24`. Verify the toggle is wired by scrolling 100px and confirming the header is fully opaque in the screenshot.

## JS-only render / empty content

**Symptom:** Served HTML's `<title>` is empty OR there's no `<h1>` text. Visual screenshot may show a blank or partial page.

**Why it happens:** Astro builds to static HTML — if a build error caused only `404.html` to ship, or the wrong dist was uploaded to Cloudflare, the served page won't have content. Less commonly: Cloudflare deploy succeeded but the wrong commit was active.

**Fix:** Re-run stage-3 + stage-4 for this lead. Confirm `npm run build` exits 0 locally with the lead's `data.json`. If it does, the deploy pipeline (stage-4) is at fault; if it doesn't, the data.json shape needs investigation.

## Logo too small on mobile

**Symptom:** On mobile (390px), the floral/raster logo looks like a 24px favicon next to a much-larger pink CTA pill.

**Why it happens:** Original Header.astro had `w-8 h-8` (32px) for all viewports. The CTA pill at 40px tall visually dominates.

**Fix:** `Header.astro` logo img — `w-10 h-10 sm:w-9 sm:h-9` (40px below sm, 36px at sm+). Restores proportional balance with the pill.
