# Outreach Spine & Engine — Design

> Sub-project #1 of the "whole-site IA + workflow" effort. Decomposition + the
> remaining sub-projects are listed under *Out of Scope*. This spec covers the
> operator workflow spine, lead selection, and the campaign/send model.
> Date: 2026-06-04.

## Problem

There are **two overlapping, contradictory ways to send** to leads:

1. **Campaigns** (`/campaigns` + the New-campaign wizard) — you filter by
   channel + segment + country/category, then it **auto-snapshots `target_count`
   leads** (`selectSnapshot`). You can't choose *which* leads. The Audience step
   shows a count (and now a preview), but no way to pick.
2. **Leads page → "Send via best channel"** — here you **do** hand-pick leads
   (checkboxes), but it's a one-off send (not a campaign) that routes by "best
   channel" instead of a channel you chose.

So lead-selection exists in one surface but not the other, and "campaign" vs
"bulk send" are two names for nearly the same act. The operator can't answer
"send to *these specific* leads, by *this* channel, and track it."

## Goals

- **One way to send.** Selecting leads and sending is a single, obvious flow.
- **Pick the leads.** Hand-pick individual leads or "select all N matching" — no
  more blind count-snapshot.
- **Channel chosen once, up front**, so only reachable leads are added (no bare
  "0 match" dead-ends).
- **A clear spine** the operator walks: Scrape → Review & pick → Send → Replies →
  Measure, with each page serving one act and redundant pages retired.
- **Send behavior fits the channel** and matches what's actually wired.

## Non-Goals (YAGNI / deferred)

- A background auto-scheduler (`setInterval` queue, cross-instance atomic claim).
  MVP sends on-demand within caps; the full scheduler is a later phase.
- Multi-step follow-up **sequences** (step 2/3 cadence).
- Redesigning the Inbox, the Leads triage UI, or dashboards — those are
  sub-projects #2–#4 (see *Out of Scope*).
- Changing the protected `leads.stage` enum or the `{success,data|error}` envelope.

## Decisions (locked during brainstorming)

1. **Selection surface = the Leads page** (the "workbench"). You filter + tick
   leads there, then "Add to campaign". The wizard slims down.
2. **Send model = channel-appropriate.** Email/SMS auto-send within caps + the
   schedule window after Launch; Voice/DM become a work-queue.
3. **Approach 1** ("Leads = workbench, Campaign = send hub"). Rejected: a parallel
   ad-hoc "quick send" (reintroduces two-ways-to-send); in-wizard selection
   (contradicts decision 1).

## The Spine & IA

The operator journey is five acts; each has exactly one home:

| Act | Page | Role |
|---|---|---|
| Scrape | **Batches** | intake — runs that pull leads |
| Review & pick | **Leads** | the workbench: filter, triage, select |
| Send | **Campaigns** | the send hub — one channel per campaign |
| Replies & follow-up | **Inbox** | conversations across all channels |
| Measure | **Today / Analytics / Status** | at-a-glance + reporting |

**Nav groups:** Overview (Today, Analytics, Status) · Pipeline (Batches, Leads) ·
Outreach (Campaigns, Inbox) · Settings (Email accounts, Agent).

**Retired pages:** `/calls` → a voice campaign's work-queue (a campaign's detail);
`/replies` → merged into **Inbox** (already largely is). Routes may remain
reachable but leave the nav; their content lives in Campaigns + Inbox.

## Core Flow: Selection → "Add to campaign"

On **Leads**:

1. Filter (stage / segment / channel-eligibility / country / category / search).
2. Multi-select rows (row checkbox + a header "select all N matching" that spans
   the whole filtered set, not just the visible page).
3. A sticky action bar shows the count and an **"Add to campaign"** button.
4. The button opens a small dialog (`AddToCampaignDialog`):
   - **Channel** picker (Email / SMS / DM / Voice). The dialog shows
     *"X of your Y selected are reachable by <channel>"* and **only those X are
     added** (the rest are reported as skipped, with the reason).
   - **Destination:** *new campaign* (name field) **or** *add to an existing*
     campaign of the same channel.
   - Confirm → members are written to the campaign.

The Campaigns page keeps a **"New campaign"** button → creates an **empty draft**
(name + channel + schedule), then "Add leads" deep-links to a Leads view
pre-filtered to that channel's eligible leads. (Same underlying add action.)

## Campaign Model & Lifecycle

A campaign is `{ name, channel, schedule, members[] }` — reusing the existing
`call_campaigns` row + `campaign_leads` membership rows.

**States:** `draft` (building membership; nothing sent) → `active` (launched —
sending or being worked) → `done` (no members left to action). A `paused` state
remains available for halting an active campaign.

**Send behavior by channel:**

- **Email / SMS** — a **Launch** action sends to pending members **within the
  daily cap + schedule window** (warmup + `EMAIL_SENDING_PAUSED_UNTIL` kill-switch
  already enforced for email). Sends run on-demand in capped batches; members over
  today's cap stay `pending` for the next Launch/window. A progress indicator
  shows sent / queued.
- **Voice / DM** — the campaign **detail is a work-queue**: members listed with
  per-lead status; the operator/agent dials (existing call flow) or sends the DM
  and logs the outcome. (Voice = today's `/calls` queue, now scoped to a campaign.)

**Campaign detail shows:** members + per-lead status (`pending` / `sent` /
`replied` / `skipped` / outcome) + that campaign's conversion funnel. Per-lead,
per-campaign status lives on `campaign_leads.status`; the lead's global
`leads.stage` is untouched.

## What This Removes (the confusion)

- **One send path:** select on Leads → Add to campaign. The Leads-page "Send via
  best channel" bulk action is **replaced** by "Add to campaign".
- **Channel chosen at add-time** → only eligible leads join → no bare "0 match".
- `/calls` and `/replies` retire from the nav into Campaigns + Inbox.

## Components (units & boundaries)

- **`AddToCampaignDialog`** (client) — inputs: selected `leadIds`; lets the user
  pick channel + new/existing campaign; calls the add API; reports added/skipped.
  Depends on: a campaigns-list fetch (existing-of-channel) + the add endpoint.
- **Leads multi-select + action bar** — extends the existing `LeadsTable`
  selection; "select all N matching" needs the current filter, not just the page.
- **Add-members API** — `POST /api/campaigns/:id/leads` (add to existing) and the
  existing `POST /api/campaigns` (create with explicit `lead_ids`, the csv/manual
  path) generalized so "app" source also accepts explicit `lead_ids`. Both filter
  the incoming ids by channel eligibility + suppression and dedupe against current
  members. Returns `{ added, skipped: { reason → count } }`.
- **Campaign Launch API (email/SMS)** — `POST /api/campaigns/:id/launch` sends to
  `pending` members up to the remaining daily cap (reusing `stage-5-email` /
  `stage-6-sms` per-lead senders + their guards). Idempotent; safe to re-run.
- **Campaign detail (channel-aware)** — render send-progress for email/SMS, a
  work-queue for voice/DM.
- **Nav config** — drop `/calls`, `/replies` from `lib/nav.ts`.

The `target_count` + `selectSnapshot` auto-pick path is **deprecated** (selection
is now explicit `lead_ids`). The column can stay for back-compat but the UI no
longer drives it.

## Error Handling & Edge Cases

- Selected lead not eligible for the chosen channel → excluded; counted in
  `skipped` with reason `not_reachable`.
- Lead already a member → deduped (the `(campaign_id, lead_id)` unique key).
- Suppressed / unsubscribed lead → excluded from sends (existing `isSuppressed`).
- Daily cap reached mid-Launch → remaining members stay `pending`; Launch reports
  how many sent vs deferred.
- Kill-switch (`EMAIL_SENDING_PAUSED_UNTIL`) active → Launch sends nothing and
  says so.
- Empty campaign Launch → no-op with a clear message.
- "Select all N matching" must use the **filter**, not the fetched page, so it
  can exceed the page size.

## Success Criteria

- The Leads-page "Send via best channel" bulk action is gone; "Add to campaign"
  replaces it, and is the only send entry point.
- An operator can hand-pick leads *or* "select all matching" and add them to a
  new or existing campaign, choosing the channel once.
- Only channel-eligible, non-suppressed, non-duplicate leads become members; the
  dialog reports what was skipped and why.
- Launching an email/SMS campaign sends within the daily cap + window; a voice/DM
  campaign presents a work-queue.
- `/calls` and `/replies` are absent from the nav; their function is reachable via
  Campaigns + Inbox.
- `npm run typecheck` + `npm run lint` clean.

## Out of Scope — the other sub-projects (future specs)

- **#2 Unified inbox & follow-up** — one conversation inbox across channels;
  reply → meeting → close workflow.
- **#3 Lead review & qualification** — Leads list/detail triage, quality signals,
  per-lead actions.
- **#4 Intake + dashboards** — Batches polish; Today/Analytics/Status reflecting
  the spine.
- **Cold-email hardening (separate track)** — background auto-scheduler, multi-step
  sequences, verification cascade, bounce handling, credential encryption-at-rest
  (see `reference_email_sending_blueprint`).
