# Status Updates

One file per ISO week, named `YYYY-Www.md` (e.g. `2026-W17.md`).

Authored by the operator or by the `status-reporter` skill.

## Template — copy this when starting a new week

```markdown
# Week YYYY-Www  (Apr 27 – May 03)

## Done
<!-- bullets — what shipped -->
- ...

## In progress
<!-- mid-flight items -->
- ...

## Blocked
<!-- waiting on a decision, an external thing, or a person -->
- ...

## Numbers
| Metric | This week | Cumulative |
|--------|-----------|------------|
| Batches run | 0 | 0 |
| Leads scraped | 0 | 0 |
| Sites deployed | 0 | 0 |
| Emails sent | 0 | 0 |
| Replies | 0 | 0 |
| Meetings booked | 0 | 0 |
| Closes | 0 | 0 |
| MRR added | $0 | $0 |

## Next week
- ...

## Notes
<!-- anything else worth remembering -->

---

### Daily log

#### YYYY-MM-DD
- ...
```

## Conventions

- Replace, don't append, when re-running `status-reporter` for the same week.
- Keep "Daily log" entries one-line each.
- Don't put PII (emails, phone numbers) in status updates — keep aggregate.
- When a week wraps, the file becomes immutable history. Fix small typos only.
