# Workflow — Add a new niche template

**Objective:** Build one new Astro template under `templates/<niche>/` so the pipeline can target a new vertical.

## When to do this
- Expanding to a new niche (e.g. "food-beverage" beyond "trades").
- Existing template doesn't fit a niche's content (e.g. trades template has no menu section for restaurants).

## Steps

1. **Copy a known-good template as a starting point.**
   ```bash
   cp -R templates/trades templates/<niche>
   ```

2. **Edit the design.**
   - `src/pages/index.astro` — order of sections.
   - `src/components/` — pick / add Hero, Services, Reviews, Gallery variants.
   - `src/styles/tokens.css` — CSS variables (`--brand-primary`, `--font-heading`, etc.).
   - All values come from `data.json` at build time — never hard-code business info.

3. **Use AI to accelerate (Cursor / Lovable / Claude Code).**
   This is the place where it's OK to spend AI tokens on design iteration. The
   template is built **once**; production runs only inject data.

4. **Build locally with sample data.**
   ```bash
   cd templates/<niche>
   cp src/data.sample.json src/data.json
   npm install
   npm run dev      # http://localhost:4321
   ```

5. **Verify three scenarios:**
   - rich data (lots of photos, reviews, services)
   - thin data (1 photo, 5 reviews, 2 services)
   - missing data (no photos, no reviews) — must still look intentional

6. **Update CLAUDE.md** with the new template_slug under the templates table, and add a row in `docs/architecture.md` noting which niche it serves.

## Quality bar
- Lighthouse mobile score ≥ 90 on all three scenarios.
- Loads in <1s on 4G.
- Renders correctly with `data.json` fields removed (graceful degradation).

## Don't
- Don't build N templates per N businesses. **One template per niche, many businesses.**
- Don't hard-code colors, names, hours, or phone numbers anywhere in the template.
