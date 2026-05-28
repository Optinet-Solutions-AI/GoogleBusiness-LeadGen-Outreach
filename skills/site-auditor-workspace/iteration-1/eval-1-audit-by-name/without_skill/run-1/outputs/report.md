# Audit — `the-little-things-balloon-garlands-event.pages.dev` (deploy `181bdf65`)

**Business:** The Little Things — balloon garlands & event styling, Frankton / Hamilton, NZ
**Audited:** 2026-05-28
**Pages checked (raw HTTP):** `/`, `/about/`, `/contact/`, `/service-area/`, `/services/balloon-garlands/`, `/services/event-styling/`, `/services/party-packages/`, `/services/backdrops-props/`, `/robots.txt`, `/sitemap-index.xml`, `/favicon.ico`
**All pages return 200** (subpages 308-redirect from `/about` → `/about/` then 200 — normal Cloudflare Pages trailing-slash behavior, not a bug).

The site looks polished from 30 feet. Up close there are roughly a dozen distinct issues. Grouped by severity.

## 1. Showstoppers — the kind a prospect notices in 5 seconds

### 1.1 Raw Google Places category name leaks as the eyebrow label
Top of the hero, above the H1, displayed in caps as part of the editorial credit strip:

> **`home_goods_store` · Frankton · Locally owned + operated**

`home_goods_store` is the literal Google Places `primaryType` enum. It should never make it to the rendered page. For a balloon-garland / event-styling business, the eyebrow should be something like "Event Styling". This is the single most embarrassing item on the page — the prospect reads "home goods store" before the headline.

It also leaks into the JSON-LD: `"description":"home_goods_store serving Frankton."` (raw HTML line ~28). Search engines will index that string verbatim.

### 1.2 "See Our Gallery — 24/7" sits as the kicker above the phone number
In the hero, next to the phone-button:

> **SEE OUR GALLERY — 24/7**
> **021 150 8047**

`cta_secondary` in the data is the literal string "See Our Gallery", but the template renders it as the kicker above the phone link — so it reads as if calling the phone gets you a gallery. The labels/slots in the component are crossed. Also: **there is no gallery page on this site** (nav is Home / Services / About / Areas / Contact), so the "See Our Gallery" CTA has nothing to point at.

### 1.3 The "Since Day 1 / in town" badge
A tilted decorative stamp on the hero image reads:

> **SINCE**
> **Day 1**
> **IN TOWN**

That's template-default fallback text for a missing `since_year` field. It reads as a typo or as broken content. Replace with a real year, or hide the badge when the year is unknown.

### 1.4 Inflated review count vs. shown reviews — and false 5-star displays
- JSON-LD `aggregateRating`: **rating 4.2, reviewCount 5**.
- Reviews actually shown on the page: **3** (Sarah M., David L., Jessica P.).
- Every shown review is rendered with **5 filled stars**, and each `reviewRating.ratingValue` in JSON-LD is also 5. With a 4.2 average across 5 reviews, two of the five must be 3- or 4-star — they are simply hidden, so the page shows a perfect-5 picture that contradicts its own 4.2 headline.
- This is a Google rich-results policy risk too: showing only the positive subset while claiming a 4.2 aggregate is a "review-snippet" violation that can disqualify the page from review stars in SERPs.

### 1.5 Reviews look like AI-generated stock testimonials
All three reviews mention the brand by full name, all three name-drop Frankton/Hamilton, all three are roughly the same length, all three end with an exclamation. They read like Gemini wrote them, which they almost certainly were. For a demo this is acceptable; before any real handover the operator must replace them with verified reviews.

### 1.6 No real photography — six Unsplash stock images
The hero, all four service cards, and the OG/Twitter share image are all from `images.unsplash.com`. None of them are this business's work. For a styling business where the purchasing decision is entirely visual, this is the biggest *conversion* issue on the site. Outreach hook: "we'll swap in your real portfolio photos after our first call."

## 2. Real bugs that hurt SEO / UX

### 2.1 Title is a wall of keywords
```
Home — The Little Things | Balloon Garlands & Event Styling Hamilton
```
74 characters — Google truncates at ~60. "Home —" is dead weight. Suggested: `The Little Things — Balloon Garlands & Event Styling, Hamilton`. The header logo `alt` and the visible brand label in the nav reuse the same long slug — the visible brand should be "The Little Things" with the rest as tagline.

### 2.2 Missing `/favicon.ico` and missing root `/sitemap.xml`
- `/favicon.ico` → 404. The page uses an inline SVG data-URI favicon (a pink "T" tile) which works in modern browsers but breaks the legacy fallback.
- `/sitemap.xml` → 404. The real sitemap is at `/sitemap-index.xml` (200) → `/sitemap-0.xml` (200), which is fine, and `robots.txt` references `sitemap-index.xml` correctly — minor cosmetic loose end only.

### 2.3 All six photos have empty `alt=""`
Hero image is `decoding=sync fetchpriority=high`, i.e. it's important content. Empty alt = accessibility miss + lost keyword opportunity (e.g. `alt="Pastel balloon garland by The Little Things, Frankton"`).

### 2.4 "Locally owned in Frankton." repeats four+ times on the home page
It's the `social_proof_line` field, used in the eyebrow, hero overlay, reviews intro, and footer. Reads as filler when seen this many times.

### 2.5 Address vs. service-area-only flag is contradictory
`is_service_area_only: false` and a hard street address (`101 Colombo Street, Frankton, Hamilton 3204`) are published, but the copy positions this as a mobile decor service ("we bring our joyful styling directly to your doorstep"). If 101 Colombo Street is not a customer-visiting storefront, this address shouldn't be in the footer, the embedded Google Maps iframe, or the JSON-LD `PostalAddress`. A wrong storefront address on a published demo is a credibility kill.

### 2.6 Phone number — no country code in `tel:`
`tel:0211508047` works for a domestic NZ visitor but `tel:` should be E.164: `tel:+642115008047`. JSON-LD `telephone` should likewise be `+64 21 150 8047`.

### 2.7 No email shown anywhere
`email: null` in every props payload. Contact form has an email *field*, but no email address is ever displayed on the site.

### 2.8 Map iframe zoomed out to the whole region
`https://www.google.com/maps?q=...&z=11` shows the whole Waikato; the pin is barely findable. Use `z=14` or `z=15`.

### 2.9 Malformed inline CSS on the H1 (and several siblings)
Rendered HTML line 141:
```html
<h1 ... style="font-size:clamp(2.25rem, 5.2vw, 4.75rem);line-height:1;font-variation-settings:&quot;transform:translateY(24px)">
```
`font-variation-settings:"transform:translateY(24px)` is a corrupted CSS value — the template tried to set both `font-variation-settings` and `transform` but quoting collapsed. The browser silently drops the rule, so the H1's entrance animation never plays. Same pattern recurs on lines 160, 215, 220.

### 2.10 SSR blocks ship with `opacity:0`, animated in only by JS
The eyebrow strip (line 104), trust strip (164), hero image (185), badge (190) and several others are SSR'd at `opacity:0`. Users with JS disabled or slow hydration see permanent blank rectangles. Either animate FROM `opacity:0` in pure CSS, or add a `noscript` fallback that forces these to visible.

## 3. Polish — small but they matter

- **"Frankton" appears 20+ times** on the home page in barely-varied phrasing.
- **Footer**: "Licensed & insured local business." — verify; the phrasing isn't standard NZ usage.
- **Sticky-bar component** is configured in the data variant but I didn't see a sticky CTA bar rendered.
- **OG image is generic stock**.
- **JSON-LD `priceRange:"$$"`** is a fabricated guess. Drop the field rather than invent it.

## 4. Working well — keep

- Mobile layout is clean.
- Structured data is comprehensive.
- `robots.txt` correctly allows GPTBot / ClaudeBot / PerplexityBot etc.
- All internal nav links resolve 200.
- Visual design reads editorial and high-end.

## 5. Priority fix list (in order)

| # | Fix | Where | Effort |
|---|-----|-------|--------|
| 1 | Replace `home_goods_store` everywhere with a real category label | template + lead data | 10 min |
| 2 | Fix or remove the "See Our Gallery — 24/7" kicker | template + `cta_secondary` data | 30 min |
| 3 | Replace the "Since Day 1 / in town" badge | hero template | 5 min |
| 4 | Show all 5 reviews honestly OR drop `aggregateRating` | JSON-LD generator | 15 min |
| 5 | Replace stock Unsplash images at the "improve" stage | pipeline / handover | n/a |
| 6 | Verify or remove the 101 Colombo Street address | lead data | n/a |
| 7 | Trim `<title>`, brand label, logo alt | layout component | 10 min |
| 8 | Fill in real `alt` text on photos | image components | 10 min |
| 9 | Fix the malformed `font-variation-settings:` inline styles | hero / split components | 10 min |
| 10 | Switch `tel:` and JSON-LD telephone to E.164 | layout + JSON-LD | 5 min |
| 11 | Bump Google Maps iframe zoom to `z=14` | service-area component | 1 min |
| 12 | Add `noscript`/CSS fallback for SSR `opacity:0` blocks | global stylesheet | 15 min |

Items 1–6 are the ones a prospect actually notices.
