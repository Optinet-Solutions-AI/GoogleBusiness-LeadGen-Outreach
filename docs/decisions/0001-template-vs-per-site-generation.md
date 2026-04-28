# ADR 0001 — Template + AI copy injection vs. per-site full generation

**Status:** Accepted
**Date:** 2026-04-27

## Context

Two ways to produce a personalized website per lead:

1. **Per-site full generation** — call Lovable / v0 / a chat LLM to generate the entire site from scratch for each business.
2. **Template + AI copy injection** — build one polished Astro template per niche, inject business data + AI-written copy at build time.

## Decision

We go with **template + AI copy injection**.

## Why

| Axis | Per-site | Template + injection |
|------|----------|----------------------|
| Time per site | 5–10 min | 10–30 sec |
| Cost per site | $0.30–2.00 | ~$0.02 |
| Quality | Inconsistent, unpredictable | Consistent (locked by template) |
| Visual variety | High in theory, generic in practice | Achieved via design tokens, layout variants, conditional sections |
| Iteration speed | Slow (regenerate everything) | Fast (edit template once, all sites benefit) |

The "won't they look identical" worry is mitigated by:
- CSS variables for brand color (extracted per business)
- 3–5 hero / services / gallery component variants picked from data
- Section ordering that follows data quality
- Conditional sections (only render what data supports)
- AI-written copy in the business's voice

Side-by-side comparison would still betray template lineage — same way two Squarespace sites are recognizably both Squarespace. Prospects compare their site to **nothing**, not to other prospects'.

## Consequences

- The first template is high-leverage. **Real design effort goes into it.** It's the asset everything else depends on.
- We need 3–5 templates over time (one per major vertical: trades, food/beverage, beauty/wellness, professional services).
- The Python generation script is small and stable. The art lives in the templates.
- LLM role (currently Gemini 2.5 Flash) is reduced to copy generation only — a job it does well, on free tier.

## Reconsider when

- Volume scales past ~5,000 sites/month (where template uniformity might start mattering).
- A specific niche refuses to convert with the template approach (then build a higher-touch flow for that niche only).
