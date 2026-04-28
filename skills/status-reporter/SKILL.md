---
name: status-reporter
description: Read recent activity (DB, git, file changes) and write or update the weekly status entry under docs/status/. Use when the operator says "where do we stand", "write the weekly update", "what happened this week", or end-of-week.
---

# status-reporter

## Goal
Produce or update the file at `docs/status/<YYYY>-W<WW>.md` for the current ISO week. This file is the single canonical record of "what happened lately" — CLAUDE.md is the system, status/ is the diary.

## When invoked

1. Resolve current ISO week → `<YYYY>-W<WW>.md`.
2. If the file doesn't exist, create it from the template at `docs/status/README.md` (sections below).
3. Gather inputs:
   - **DB** — counts:
     ```sql
     select status, count(*) from batches where created_at > now() - interval '7 days' group by status;
     select stage,  count(*) from leads   where created_at > now() - interval '7 days' group by stage;
     select kind,   count(*) from outreach_events where created_at > now() - interval '7 days' group by kind;
     ```
   - **git log** — `git log --since='7 days ago' --pretty=format:'%h %s' | head -50`
   - **Open issues / blockers** — ask the operator if anything new.
4. Write into these sections (append or replace existing values):
   - **Done** — bullets of what shipped this week
   - **In progress** — what's mid-flight
   - **Blocked** — anything waiting on a decision or external thing
   - **Numbers** — leads scraped, sites deployed, emails sent, replies, closes
   - **Next week** — concrete planned items
5. Print the diff to the operator and ask for approval before saving.

## Daily mode
If invoked mid-week, append a `### YYYY-MM-DD` section under "Done" with what just happened. Don't re-write the whole file.

## Don't
- Don't fabricate numbers. If DB is unreachable, say so.
- Don't overwrite past weeks' files.
- Don't include any secrets or PII (emails, phone numbers) in status — keep aggregate.
