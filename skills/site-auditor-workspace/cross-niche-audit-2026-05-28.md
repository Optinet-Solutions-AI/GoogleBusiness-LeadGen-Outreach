# Cross-niche audit — all deployed leads (2026-05-28)

Ran the site-auditor against every lead in the DB with a `demo_url` set. Three sites, three different hero variants, three different niches:

| Lead | Niche | Hero | Brand color | Demo URL |
|---|---|---|---|---|
| The Little Things \| Balloon Garlands & Event Styling Hamilton | event-services | `editorial-split` | `#CE6986` rose | [181bdf65.…pages.dev](https://181bdf65.the-little-things-balloon-garlands-event.pages.dev) |
| Estate Sales & Treasures | home-goods-vintage | `parallax-photos` | `#D7431B` burnt-orange | [84781ce8.…pages.dev](https://84781ce8.estate-sales-treasures.pages.dev) |
| Mimi and Me Estate Sales | home-goods-vintage | `full-bleed-photo` | `#DDC86A` gold | [2882ba3b.…pages.dev](https://2882ba3b.mimi-and-me-estate-sales.pages.dev) |

## Programmatic finding counts

| Site | High | Medium | Low |
|---|---:|---:|---:|
| The Little Things | 0 | 2 | 0 |
| Estate Sales & Treasures | 0 | 1 | 0 |
| Mimi and Me | 0 | 0 | 0 |

Mimi and Me's clean score is **misleading** — the auditor's regex checks didn't fire, but visual inspection of the screenshot turned up the same class of issues. The regex is too narrow.

## Headline diagnosis

**All three sites ship stale Cloudflare Pages bundles.** They predate the recent template fixes — commits `467eef1` (dropped category from all 6 hero variants), `02ac047` (mobile header polish), and `f041f80` (eyebrow cleanup). The current `templates/premium-trades/src/` source already resolves every category/eyebrow/rating-chip issue listed below. Running stage-3 → stage-4 again for each lead clears the lot in one pass.

## Per-site findings

### 1. The Little Things — editorial-split hero

| # | Issue | Severity | Source |
|---|---|---|---|
| 1 | Eyebrow shows `HOME_GOODS_STORE` slug (rendered uppercase via CSS) | medium | regex |
| 2 | Eyebrow shows `★ 4.2 · 5 reviews` next to the slug | medium | regex |
| 3 | Header brand text "Balloon Garlands & Event Styling Hamilton" wraps to **3 lines** on 390px mobile — the `|` prefix-strip gave us the verbose long-tail half of the Google Business name | medium | screenshot |
| 4 | Floating rating chip overlaid on hero photo | medium | regex |

### 2. Estate Sales & Treasures — parallax-photos hero

| # | Issue | Severity | Source |
|---|---|---|---|
| 1 | Eyebrow shows `HOME_GOODS_STORE` | medium | regex |
| 2 | Header "Start Your Discovery" CTA pill wraps to **2 lines** on mobile | medium | screenshot |
| 3 | CTA pill is **dark navy** but the lead's brand color is `#D7431B` burnt-orange (the "ES" monogram correctly shows the orange — palette inconsistency between header monogram and CTA) | medium | screenshot |
| 4 | Floating `★★★★★ 5.0 · Locally owned…` rating badge below the hero | medium | screenshot |

### 3. Mimi and Me Estate Sales — full-bleed-photo hero

| # | Issue | Severity | Source |
|---|---|---|---|
| 1 | Eyebrow shows `CONSULTANT · MOBILE` — single-word category, no underscores, so the auditor's regex missed it | medium | screenshot |
| 2 | Header "Schedule Consultation" CTA pill wraps to **2 lines** on mobile | medium | screenshot |
| 3 | CTA pill is **dark navy** but the lead's brand color is `#DDC86A` gold (header monogram is GREEN — neither matches the DB color) | high | screenshot |
| 4 | Floating `★★★★★ 4.0 · Locally owned…` chip overlaid on hero photo | medium | screenshot |

## Patterns across niches

Mapping which patterns affect which sites:

| Pattern | Little Things | Estate Sales | Mimi and Me | Status |
|---|:---:|:---:|:---:|---|
| Category slug in eyebrow | ✗ | ✗ | ✗ (clean text but still wrong) | source already fixed (deploy stale) |
| Hero rating chip / badge | ✗ | ✗ | ✗ | source already fixed (deploy stale) |
| Mobile header text overflow | ✗ | ✗ | ✗ | source has short-brand logic but per-lead names still overflow |
| Mobile CTA pill text wrap | — | ✗ | ✗ | not yet addressed in source — CTA copy is per-lead Gemini-generated |
| Brand color injection mismatch | — | ✗ | ✗ | source has logo-lock fix, but these leads were generated before |

Every issue surfaced here is either (a) already fixed in source and just needs redeployment, or (b) a per-lead Gemini-copy issue (overlong CTA text) that the operator can't fix in the template.

## Auditor weaknesses found during this audit

The programmatic checks had false negatives. The skill should be updated to:

1. **Category eyebrow**: my regex required an underscore, so "CONSULTANT" / "PLUMBER" / "BARBER" pass through clean. Better check: any single uppercase word in the eyebrow that *isn't* a city name from `data.service_areas` or `data.address`.
2. **Mobile header overflow**: needs OCR-on-screenshot or a Playwright check measuring text height of the brand `<a>`. Currently relies on the human spotting it.
3. **CTA color mismatch**: compare the CTA pill's computed bg-color to `data.palette.primary` via Playwright. High-value check — would have caught Estate Sales + Mimi and Me at the same time.
4. **Rating chip in hero**: detected the Little Things one (had "verified reviews" text), missed Estate Sales + Mimi and Me (their badges say "Locally owned" instead of "reviews"). Broaden the keyword list, or just flag any star+rating glyphs inside the `<section>` containing the H1.

## Recommended action

1. **Redeploy first** — the cheapest move. Once gcloud auth is sorted, rebuild the Cloud Run image and regenerate all three leads from stage="generate". That clears items #1, #2, #4 across every site (no Gemini call required since stages 2 carry over).
2. **For Estate Sales + Mimi and Me**: also re-run stage-2 so the palette gets re-derived from the logo bytes (the new `derivePalette(lead.brand_color)` lock in `stage-3-generate.ts` only fires if the lead has a real raster logo). One ScrapingBee credit per lead if logo discovery has to start from scratch.
3. **Iterate the auditor** — extend the checks above so this kind of cross-site audit catches the issues programmatically next time rather than via human screenshot review.

## Artifacts

Per-site dumps under `C:\tmp\audit-batch\`:
- `the-little-things-balloon-garlands-event/`
- `estate-sales-treasures/`
- `mimi-and-me-estate-sales/`

Each contains `served.html`, `findings.json`, and the 4 viewport screenshots.
