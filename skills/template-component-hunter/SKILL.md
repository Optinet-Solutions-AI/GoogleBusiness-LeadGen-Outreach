---
name: template-component-hunter
description: Find and install premium UI components for the website-generator templates. Use when the operator wants to add a new section variant (hero, services grid, review marquee, CTA, footer, etc.), upgrade the visual quality of templates/<niche>/, or replace a section that "looks too simple". Sources from 21st.dev, typeui.sh, and getdesign.md.
---

# template-component-hunter

The job: turn an operator brief like *"hero with parallax video, dark, contractor vibe"* into a working component file inside `templates/<slug>/src/components/<section>/<variant>.tsx`, registered in the variant registry, building cleanly.

This skill is the **sourcing** half of template work. The actual UI implementation / refinement is the `frontend-design` skill's job — invoke it after the candidate is dropped in.

---

## When invoked

Operator says something like:
- "find me a hero with parallax video for plumber sites"
- "I need a more impressive review section"
- "the services section is boring, find a bento grid variant"
- "the hero looks generic, replace it"

If the brief is vague, ask 3 questions max:
1. **Section** — hero / services / reviews / trust / service-area / CTA / footer?
2. **Vibe** — dark or light? minimal or maximalist? corporate or playful?
3. **Interaction** — hover-only, scroll-triggered, click-to-reveal, video bg, none?

Don't ask more than that. Operators don't have detailed answers; pick reasonable defaults and show options.

---

## Sources (search in this order)

1. **21st.dev** — `https://21st.dev/components`
   - Community-curated shadcn/ui + Framer Motion library. Best for animated, interactive components.
   - Most components are MIT.
   - If `@21st-dev/magic` MCP is available, prefer it over WebFetch — returns structured component metadata.
2. **typeui.sh**
   - Typography-and-layout-focused premium components. Strong for hero / pricing / CTA.
   - Check license per-component.
3. **getdesign.md**
   - Design-system reference catalogues. Use for inspiration and to cross-check what "professional" looks like in 2026 — not always for direct copy-in.

If none of the three has a fit, fall back to a WebSearch for `"<section name>" shadcn framer motion site:github.com` and surface the top open-source results.

---

## Steps

### 1. Confirm brief

Restate the brief in one line so the operator can correct it. Example:
> "Confirming: dark-mode hero, parallax/scroll-driven, contractor (plumber/HVAC) vibe, prominent phone CTA. Right?"

### 2. Search the sources

WebFetch the matching category pages on 21st.dev / typeui.sh / getdesign.md. For 21st.dev, the URL pattern is `https://21st.dev/components/<category>`. Look for:
- A live preview screenshot or demo URL
- Source code visible (or downloadable)
- License (MIT preferred; AGPL/non-commercial = skip)
- Dependency list (Framer Motion, shadcn/ui, Lucide → fine. Next/Image, Next/Link → must strip)

### 3. Return 3–5 candidates

Format each candidate as:
```
1. <component name> — <one-line vibe description>
   Source:        <URL>
   License:       MIT / Apache / proprietary
   Dependencies:  framer-motion, @radix-ui/react-tooltip
   Notes:         uses next/image — needs Astro adaptation
```

Don't dump full component code in the response. Operator picks first; then the skill installs.

### 4. Install the picked candidate

After the operator picks (e.g., "go with #2"):

1. **Drop the file** at `templates/<slug>/src/components/<section>/<variant>.tsx`. Strip Next.js-only imports (`next/image` → `<img>`, `next/link` → `<a>`). Convert default exports to named where the registry expects it.
2. **Register the variant** in `templates/<slug>/src/lib/variants.ts`:
   ```ts
   export const variants = {
     hero: {
       'parallax-video':    { component: () => import('../components/hero/parallax-video'),    needs: ['video_url'] },
       'animated-gradient': { component: () => import('../components/hero/animated-gradient'), needs: [] },
     },
     // ...
   };
   ```
   `needs[]` lists the data fields the variant requires. Stage 3 uses this to filter out variants whose data isn't available for a given lead.
3. **Note new npm dependencies.** Don't `npm install` — list them and ask the operator first. The template's bundle weight matters (mobile budget: 300kb gz).

### 5. Verify it builds

```bash
cd templates/<slug> && npm run build
```

If the build fails, the most common causes are:
- Next.js imports left in — grep `next/`
- shadcn `@/` path aliases — Astro doesn't resolve those by default; either configure the alias or rewrite to relative imports
- Framer Motion needing a React island wrapper — add `client:visible` directive in the parent `.astro` file

If it builds, open the dist locally for the operator to preview:
```bash
npx serve templates/<slug>/dist
```

---

## Variant registry

Each template owns `src/lib/variants.ts`. Stage 3 reads `lead.variants[section]` (set during scrape-time enrichment based on data richness) and dynamically imports the matching component. If `lead.variants[section]` is missing, stage 3 falls back to a default per the rules in `templates/<slug>/src/lib/picker.ts`.

Picker rules (default for `premium-trades`):
- **hero**: `photos.length >= 6` → parallax-video; else → animated-gradient
- **services**: `services.length >= 6` → tabs-illustrated; else → bento-grid
- **reviews**: `rating >= 4.5 && review_count >= 50` → marquee-top; `>= 10` → masonry; else → hide
- **trust**: only if `years_in_business` known
- **CTA**: sticky-bar default; if email known → multi-step quote form

When you add a variant that needs a new data field, add it to `picker.ts` so leads without that field don't accidentally pick it.

---

## Don't

- Don't install components without confirming license. AGPL / non-commercial / "personal use only" = skip.
- Don't bulk-vendor a whole library. Pick per-component.
- Don't bundle heavy deps (>100kb gz uncompressed delta) without a clear visual payoff. Mobile-first; check with the operator if a candidate brings in something big.
- Don't paste components verbatim if they reference Next.js — these templates are Astro + React islands. Strip `next/image`, `next/link`, `next/router`, etc.
- Don't skip the build verification step. Untested components will bite stage 3 in production.
- Don't create a brand-new niche template (e.g., `templates/salons/`) without explicit operator approval — that's a multi-day commitment, not a one-component drop-in.

---

## Reference

- Premium template lives at `templates/premium-trades/` (TBD — built when we replace `templates/trades/`).
- Stage 3 generator: `web/lib/pipeline/stage-3-generate.ts`.
- Data shape stage 3 writes to `data.json`: see `web/lib/services/gemini.ts` (`SiteCopy`) plus the new `variants{}` and `palette{}` fields on the lead row.
