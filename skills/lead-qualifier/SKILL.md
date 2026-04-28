---
name: lead-qualifier
description: Apply qualification rules to leads (DB or CSV) and report which ones to drop and why. Use when the operator wants to vet a list before generating sites, audit why some leads were rejected, or tweak the filter rules.
---

# lead-qualifier

## Purpose
Run `web/lib/filters.ts:qualifies` (or its rules) over a set of leads and produce a clear keep/drop report.

## When invoked

1. Ask the operator for the source:
   - `--batch <id>` → query the DB for that batch's `leads`
   - `--csv <path>` → read a CSV (headers must include `business_name`, `rating`, `review_count`, `phone`, `category`, `has_website`)

2. For each row, apply the rules from `web/lib/filters.ts`:
   - `has_website == false`
   - `rating >= 4.0`
   - `review_count >= 20`
   - `phone` non-empty
   - `category` contains target niche

3. Output a table:
   ```
   business_name      | passes | reason (if drop)
   ----------------------------------------------
   Joe's Plumbing     | yes    | -
   Bobs Pipes         | no     | rating<4.0
   ```

4. Print summary counts: `accepted=N, rejected=M`, with rejection reasons broken down.

## If the operator wants to tweak rules

- Change the constants in `web/lib/filters.ts` (`MIN_RATING`, `MIN_REVIEWS`).
- Update `workflows/scrape_google_maps.md` "Filter rules" section to match.
- Don't edit the rules without surfacing trade-offs (lower threshold = more leads but lower close rate).
