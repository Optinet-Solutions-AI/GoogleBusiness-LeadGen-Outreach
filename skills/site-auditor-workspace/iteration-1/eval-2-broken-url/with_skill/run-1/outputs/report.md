# site-auditor report — `https://example.com`

## TL;DR

**This URL is not a generated demo site — it's the IANA `example.com` reserved-for-documentation placeholder page.** None of the lead-gen template anti-patterns apply here, and there is nothing for this skill to fix. If you meant to audit a real Cloudflare Pages demo (`<slug>.pages.dev`), re-run with the correct URL or a lead UUID / business-name fragment.

- Page title served: `Example Domain`
- `<h1>` text: `Example Domain` (14 chars)
- Total HTML payload: ~528 bytes
- No Astro/Tailwind/our-template markers in the served HTML

## What I ran

```bash
NODE_PATH=web/node_modules npx tsx skills/site-auditor/scripts/audit-site.ts https://example.com
```

Artifacts:
- HTML: `/tmp/audit/served.html`
- Screenshots: `/tmp/audit/{mobile,desktop}_{top,scrolled}.png`

## Programmatic findings (from `audit-site.ts`)

| Check | Severity | Detected | Notes |
|---|---|---|---|
| `fallback_navy_palette` | high | no | Not applicable — no `--c-primary` CSS var; this is plain inline `<style>`. |
| `expired_social_cdn_logo` | high | no | No `<img>` tags at all. |
| `raw_google_category_slug` | medium | no | No template-rendered content. |
| `hero_rating_chip` | medium | no | No hero section. |
| `duplicate_testimonial_authors` | medium | no | No reviews section. |
| `empty_render` | high | no | Title `Example Domain` + h1 14 chars — passes the heuristic, but only because the page *intentionally* has minimal content. Not a build failure. |

**Summary:** `high=0, medium=0, low=0`.

## Visual checks (screenshots)

Inspected `mobile_top.png`, `mobile_scrolled.png`, `desktop_top.png`, `desktop_scrolled.png`.

| Visual check | Result |
|---|---|
| Mobile header text truncation | N/A — no header bar exists on `example.com`. |
| Sticky CTA on mobile | N/A — no sticky CTA exists. |
| Hero text behind sticky header on scroll | N/A — no sticky header. |
| Logo proportions vs CTA pill | N/A — no logo, no CTA. |
| Broken image icons | None — the page has no images at all. |

Both desktop screenshots show identical content (the page is shorter than the viewport, so "scrolled" matches "top"). Mobile screenshots show only `Example Domain` + the IANA paragraph.

## Punch list

| Issue | Severity | Where it shows | Fix location | Status |
|---|---|---|---|---|
| URL is not a generated demo site (it's `iana.org`'s placeholder `example.com`) | — | Operator-side input | Re-run audit with a real `<slug>.pages.dev` URL, a lead UUID, or a business-name fragment | Needs your call |

No template-side fixes to apply — nothing to auto-fix, nothing to ask judgment on. The skill's scope is "audit a generated lead-gen demo site"; a URL outside that scope produces an empty punch list by design.

## Recommendation

Re-invoke this skill with one of:

1. A `pages.dev` URL of a deployed lead (e.g. `https://the-little-things-balloon-garlands-event.pages.dev/`).
2. A `leads.id` UUID — the skill will resolve via `scripts/lookup-lead.ts`.
3. A business-name fragment like `"the little things"` — same resolver.

If `https://example.com` was intentional (e.g. you wanted to confirm the auditor produces a clean report on a non-template site), this report serves as that baseline: the script ran end-to-end, fetched HTML, took 4 screenshots, and correctly reported zero anti-patterns.
