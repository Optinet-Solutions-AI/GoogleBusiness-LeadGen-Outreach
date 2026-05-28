# Cross-niche audit v2 — auditor upgraded, re-run on all deployed leads

Re-ran the (now-upgraded) site-auditor against every deployed lead in the DB. The auditor gained 4 new DOM-level checks since v1; v2 detection counts below.

## Headline numbers

| Site | Hero variant | Brand color (DB) | v1 detected | v2 detected | Notes |
|---|---|---|---:|---:|---|
| The Little Things | `editorial-split` | `#CE6986` rose | 2 | **5** | All visible mobile issues now caught programmatically. |
| Estate Sales & Treasures | `parallax-photos` | `#D7431B` orange | 1 | **4** | Eyebrow + mobile-overflow now flagged. |
| Mimi and Me Estate Sales | `full-bleed-photo` | `#DDC86A` gold | 0 (false negative) | **3** | Went from "appears clean" to 3 real findings. |

Mimi was the most important fix — the v1 auditor's regex required a snake_case slug, so "CONSULTANT" passed through silently even though it has the same problem as "HOME_GOODS_STORE".

## What the upgrade caught that v1 missed

### New check: `eyebrow_category_leak` (DOM-based, case-insensitive)
- Caught `CONSULTANT` (Mimi) — single uppercase word, no underscores, that the regex couldn't see.
- Still flags `HOME_GOODS_STORE` (Little Things, Estate Sales) the same as before.
- Reads the first eyebrow token, ignores `Locally owned …` brand voice and Title-Case city names.

### New check: `mobile_header_overflow` (DOM-based)
- Measures the brand `<a>` element's rendered height vs its line-height at 390px viewport.
- Caught all 3 sites: Little Things (112px tall, 4 lines), Estate Sales (56px, 2 lines), Mimi (56px, 2 lines).
- Previously required human screenshot inspection.

### New check: `hero_rating_chip_v2` (DOM-based, broader keywords)
- Walks the `<section>` containing the H1 looking for `1.X` decimal alongside any of: `reviews` / `locally owned` / `google` / `in <city>` / star SVG icons.
- The v1 regex required the literal phrase "verified reviews" — Mimi and Estate Sales use "Locally owned in X" and were missed.
- Now all 3 sites correctly flagged.

### New check: `cta_brand_color_mismatch` (DOM-based)
- Compares the header pill's computed `background-color` to the `--c-primary` CSS variable.
- All 3 sites currently **pass** this check — the CTA pill matches its own `--c-primary` cleanly.
- But `--c-primary` on Estate Sales (`143 188 143` sage green) and Mimi (`168 198 182` light sage) doesn't match the lead's actual `brand_color` in the DB. That's a separate gap — see "Known auditor gap" below.

## Auditor gap surfaced by this round

**`--c-primary` ≠ `lead.brand_color`** — the deployed CSS variable matches the deployed CTA (so the on-page consistency check is happy), but the deployed palette itself isn't the logo-derived one we'd want.

Detecting this requires a Supabase lookup (compare DB brand_color to served --c-primary). Adding it would couple the auditor to the DB but is the natural next iteration. For now, the operator can spot this manually by checking the lookup-lead output and eyeballing the CTA color against the brand color.

## Common pattern across all 3 sites

Every detected issue resolves to one of two underlying causes:

1. **Stale deployed bundle.** The current source code drops category, drops rating chips, and runs the palette lock — but these sites were deployed BEFORE those commits (`467eef1`, `02ac047`, `f041f80`, `65be99c`). Rebuild the Cloud Run image and run regenerate for each lead → clears the eyebrow + rating chip findings in one pass.

2. **Mobile header overflow** is per-lead. Even with the latest source, business names long enough to push the brand text into 2+ lines on 390px will still wrap. Fixable by either:
   - Tightening the `shortName` cap in `Header.astro` from 22 chars to ~16
   - Switching to logo-only on the smallest viewport when the brand text would otherwise wrap
   - Letting the operator paste an explicit `display_name` per-lead

## Per-site detail

### The Little Things — `editorial-split`
```
[medium] raw_google_category_slug   home_goods_store
[medium] hero_rating_chip           4.2 stars next to "verified reviews"
[medium] eyebrow_category_leak      "HOME_GOODS_STORE · FRANKTON"
[medium] mobile_header_overflow     brand link 112px tall — 4 lines
[medium] hero_rating_chip_v2        rating + 5 reviews keyword in hero
```

### Estate Sales & Treasures — `parallax-photos`
```
[medium] raw_google_category_slug   home_goods_store
[medium] eyebrow_category_leak      "HOME_GOODS_STORE"
[medium] mobile_header_overflow     brand link 56px tall — 2 lines
[medium] hero_rating_chip_v2        rating + "Mobile, AL" keyword in hero
```

### Mimi and Me Estate Sales — `full-bleed-photo`
```
[medium] eyebrow_category_leak      "CONSULTANT" (eyebrow: "CONSULTANT · MOBILE")
[medium] mobile_header_overflow     brand link 56px tall — 2 lines
[medium] hero_rating_chip_v2        rating + "Mobile, AL" keyword in hero
```

## Recommended next steps

1. **Push the auditor improvements** (already in working tree, just need a commit).
2. **Redeploy all 3 leads** once gcloud auth is sorted — this clears the deploy-stale findings.
3. **Tighten the `shortName` cap** in `Header.astro` to handle long names better. Or add a per-lead `display_name` override (operator types it once).
4. **(Future)** Add the `--c-primary != lead.brand_color` check via Supabase lookup. Catches the "AI palette guess won over logo lock" case that's still affecting Estate Sales + Mimi.
