# Workflow: Manage leads in the CRM board

**Page:** `/crm` (sidebar → Pipeline → CRM). One board, every lead, grouped by sales stage.

## What the board shows

| Column | `leads.stage` values | Drop allowed |
|---|---|---|
| Not contacted | scraped, enriched, generated, deployed, needs_email | no (pipeline-owned; use Build / Enroll) |
| Contacted | outreached | yes |
| Replied | replied | yes |
| Meeting booked | meeting_booked | yes |
| Meeting done | meeting_done | yes |
| Improving | improved | yes |
| Handed over | handed_over | yes |
| Won | closed_won | yes |
| Lost | closed_lost, dead | yes (→ closed_lost) |

"Not contacted" shows the 40 most recently updated with the full count; the rest live on `/leads`.

## Daily routine

1. Open `/crm`. The strip at the top shows follow-ups **overdue / today / this week**. Click one to filter the board.
2. Work the Replied column first (hottest), then overdue follow-ups.
3. Click a card → side panel: phone, email, offer, demo link, Inbox thread, timeline (emails, calls, stage changes, notes).
4. Set **Next follow-up**, **Owner** (who is handling it), **Tags** (free text, e.g. `hot`, `price-sensitive`), and add a **Note**.
5. Drag the card to the new stage when it moves (e.g. Replied → Meeting booked). Each drag is recorded in `lead_stage_events`, so KPIs stay exact.

## Rules

- Dragging never sends email, calls or builds — it only records where the deal is.
- Dropping into Lost sets `closed_lost`; suppression rules (unsubscribed / DNC) stay untouched.
- Tags and owner are free text, lower-cased, max 10 tags per lead.
- Notes are append-only (`lead_notes`); the old `leads.notes` scratch field stays as is.

## Data

- Migration `054_crm.sql`: `leads.tags`, `leads.next_follow_up_at`, `leads.assigned_to`, table `lead_notes`.
- API: `PATCH /api/leads/:id` (stage, tags, next_follow_up_at, assigned_to), `GET /api/leads/:id/timeline`, `POST /api/leads/:id/notes`.
- Logic: `lib/crm/board.ts` (columns, grouping, follow-up buckets), `lib/crm/timeline-merge.ts` (one sorted timeline from five tables).
