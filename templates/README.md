# Templates

One folder per niche. Each is a standalone Astro project that consumes a `data.json` at build time and outputs a **multi-page** static site.

## Convention

```
templates/<niche-slug>/
├── package.json
├── astro.config.mjs
├── tailwind.config.cjs
├── public/
└── src/
    ├── data.json              ← written by stage-3-generate.ts per build
    ├── data.sample.json       ← committed sample for `npm run dev`
    ├── layouts/
    │   └── BaseLayout.astro   ← head, header, footer — shared by every page
    ├── components/            ← Header, Footer, Hero, ServiceCard, ReviewCard, ContactForm, CTA
    ├── pages/
    │   ├── index.astro        ← /
    │   ├── about.astro        ← /about
    │   ├── services/
    │   │   ├── index.astro    ← /services
    │   │   └── [slug].astro   ← /services/<slug>  (one per service in data)
    │   ├── service-area.astro ← /service-area
    │   └── contact.astro      ← /contact
    └── styles/tokens.css      ← CSS variables only — values come from data.json
```

## What `data.json` looks like

Top-level fields are root facts about the business; `data.copy` is everything Gemini wrote.

```jsonc
{
  "business_name": "Joe's Plumbing",
  "phone": "(512) 555-0142",
  "email": "joe@example.com",
  "address": "1200 S Lamar Blvd, Austin, TX",
  "category": "Plumber",
  "brand_color": "#1F4E79",
  "photos":  ["https://..."],
  "reviews": [{ "author": "...", "rating": 5, "text": "..." }],
  "service_areas":  ["South Austin", "Bouldin", "..."],
  "business_hours": { "mon": "7am – 6pm", "...": "..." },

  "copy": {
    "hero_tagline": "...",
    "hero_subhead": "...",
    "trust_strip": ["Licensed & Insured", "..."],
    "about_paragraph": "...",
    "about_why_us": ["...", "..."],
    "services": [
      {
        "slug": "emergency-repairs",
        "name": "Emergency repairs",
        "short_description": "...",
        "detail_paragraph": "...",
        "bullets": ["...", "..."]
      }
    ],
    "service_area_intro": "...",
    "contact_blurb": "...",
    "meta_description": "..."
  }
}
```

The shape is enforced server-side by `web/lib/services/gemini.ts` (Gemini's structured output schema).

## Rules

- **Never hard-code business info** anywhere. All business-specific values come from `data.json`.
- Use CSS variables for colors / fonts (`--brand-primary` set in BaseLayout from `data.brand_color`).
- The Hero component picks its variant (fullbleed / split / minimal) from data quality automatically.
- Render conditionally: if `data.reviews.length === 0`, skip the reviews section. Same for service areas, hours.
- Lighthouse mobile score must be ≥ 90 with both rich and thin data.

## Local dev

```bash
cd templates/trades
cp src/data.sample.json src/data.json
npm install
npm run dev      # http://localhost:4321
```

## Adding a new niche template

See `workflows/add_new_template.md`.

## Current templates

| Slug | Niche | Pages | Status |
|------|-------|-------|--------|
| `trades` | plumbers, electricians, contractors | Home / About / Services + per-service / Service Area / Contact | scaffold complete; needs design polish for the pilot |
| `food-beverage` | restaurants, cafés | — | not built |
| `beauty-wellness` | salons, spas, gyms | — | not built |
| `professional-services` | lawyers, accountants, clinics | — | not built |
