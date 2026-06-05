# Centralized Outreach Hub — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

One place to monitor and work **all** outreach across every channel (email, DM/social,
SMS, intake forms) instead of per-channel silos. Built by converging on the data spine
the app already has, not by adding another surface.

## Problem / context

Outreach channels were built as separate surfaces (email Inbox, Social DM worklist,
campaigns, soon SMS), and monitoring is fragmenting. The app already has the makings of a
spine:

- **`outreach_events`** — a central log every channel writes to (`email_sent`,
  `email_reply`, `dm_sent`, `form_submitted`, `call_*`, `sms_*`…). `kind` is **free-text
  (no DB check constraint)**, so new kinds need no migration.
- **`/inbox`** — already merges email replies + interested calls + form submissions into
  one conversation list, but the thread view is email-shaped and calls are mixed in.
- Denormalized lead flags — `inbox_status`, `sms_status`, `call_status`, `stage`,
  `lifecycle_stage` — already act as fast "needs attention" signals.
- Per-channel message stores — `email_messages`, `sms_messages` (migration 021),
  `form_submissions`, `call_attempts`.

## Requirements (locked in brainstorming)

1. **Unified inbox** over **Email · DM · SMS · Form**, re-sourced to read from all of them.
2. **Per-channel filter** in the inbox — show only one channel at a time.
3. **Voice/calls are excluded** from the inbox conversation list (calls aren't text
   threads; they stay on the Calls/Agent page) — **but voice outcomes still count toward
   conversion**.
4. **Per-campaign conversion rate = reply/interested rate** (positive response on any
   channel, including voice-interested), shown on the Campaigns list and **sortable**.

## Architecture — event-sourced on the spine

`outreach_events` is the canonical activity log. Channels keep their own storage for
content (messages, submissions, attempts); the inbox + metrics derive from events + the
denormalized lead flags, joining the message tables only for thread content. Adding a new
channel later = it already writes events → it appears in the inbox + metrics for free.

**No migration.** `outreach_events.kind` is free-text; we standardize the naming and parse
it, with a mapper for legacy kinds. No new tables → no RLS risk (relevant given prod reads
with a key subject to RLS; all existing tables are already RLS-off).

## Components

### `web/lib/outreach/event-kinds.ts` (new) — canonical kind parser
- `Channel = "email" | "dm" | "sms" | "form" | "call"`.
- `parseEventKind(kind: string) → { channel: Channel | null; action: string; direction: "outbound" | "inbound" | "system" }`.
- Canonical kinds: `email_sent`, `email_reply`, `email_reply_sent`, `email_bounced`,
  `dm_sent`, `dm_reply`, `sms_sent`, `sms_delivered`, `sms_reply`, `form_submitted`,
  `call_completed`, `call_interested`. Legacy kinds (`email_auto_reply`,
  `email_unsubscribe`, `replied`, …) map to the nearest canonical channel/action.
- `INBOUND_POSITIVE_ACTIONS` = the set that counts as a conversation signal / conversion
  (`reply`, `submitted`, `interested`).
- Pure + unit-tested. No DB, no `server-only` → importable anywhere.

### `web/lib/outreach/inbox.ts` (new) — unified conversation layer (the brain)
- `listConversations({ channel?, limit }) → Conversation[]` where
  `Conversation = { lead_id, business_name, place, channel, direction, snippet, last_at, signal }`.
  - "Inbox-worthy" = an inbound/positive signal on **email · dm · sms · form**:
    - email — `inbox_status in ('open','needs_reply')` OR latest inbound `email_messages`
    - dm — a `dm_reply` event (created by **Mark replied**, see below — `dm_sent` alone
      is "worked", not a signal awaiting action)
    - sms — `sms_status = 'replied'` OR inbound `sms_messages`
    - form — `inbox_status = 'open'` from a `form_submissions` row
  - **Excludes** call-only leads (interested calls do NOT appear here).
  - `channel` arg filters the list to one channel.
  - Sorted by `last_at` desc. Snippet/last_at come from the per-channel message table or
    the latest event.
- `getConversation(lead_id) → { lead, timeline: TimelineItem[] }` where
  `TimelineItem = { channel, direction, body, subject?, at, status? }`, merged + ordered
  oldest→newest from `email_messages` + `sms_messages` + `form_submissions` +
  dm/`outreach_events`. Rendered as channel-aware bubbles.
- Replaces the current bespoke queries in `inbox/page.tsx` + `inbox/[id]/page.tsx`.

### Manual reply capture (channels we can't auto-read)
DM replies happen inside Instagram/Facebook with no API to read them, and SMS replies don't
arrive until Mobivate is wired. So a lead only enters the inbox as a DM/SMS conversation via
a **"Mark replied"** control (on the Social worklist row + the lead page): it `POST`s to
`/api/leads/[id]/reply-log` with `{ channel }`, which writes a `<channel>_reply`
`outreach_event` and sets `inbox_status = 'needs_reply'`. Email + form replies are captured
automatically (IMAP sync / the public form route), so they need no manual step. Once
Mobivate is live, inbound SMS auto-creates `sms_reply` and the manual SMS path is no longer
needed.

### `web/lib/outreach/conversion.ts` (new) — per-campaign conversion
- `campaignConversion(campaignIds: string[]) → Record<string, { contacted, converted, rate }>`.
  - `contacted` = `campaign_leads` members past `pending`.
  - `converted` = members whose lead shows a positive signal on **any** channel
    (reply/interested/submitted) — derived from lead flags
    (`inbox_status`, `sms_status`, `call_status`, `stage`) **and** `outreach_events`
    positive actions. Voice-interested counts here.
  - `rate = converted / contacted` (— when contacted = 0).
- Returns a plain object (cacheable via `unstable_cache`, consistent with the recent perf
  pass).

## UI

### `/inbox` (rework)
- A **channel filter bar**: `All · Email · DM · SMS · Form` (URL `?channel=`), mirroring the
  Leads page filter-pill pattern.
- List rows: channel badge + business + last snippet + relative time + signal chip, from
  `listConversations`.
- Thread (`/inbox/[id]`): the unified cross-channel **timeline**, with the right reply
  affordance per channel — email → existing reply composer; DM → existing `AssistedDmPanel`;
  form → the answers card; SMS → read-only for now (send is a fast follow-up once Mobivate
  is wired).

### `/campaigns` (add column)
- A sortable **Conversion** column (reply/interested rate) from `campaignConversion`, next
  to the existing Leads/Contacted/Interested columns. Sorting via `?sort=conversion`
  (server-side sort of the already-fetched list).

## Error handling & safety
- All reads via `safeDb` (graceful empty on failure).
- No new tables / no migration → no RLS exposure.
- Voice exclusion is an explicit filter in `listConversations` (call-only signals omitted).
- Caching: `conversion` results may use `unstable_cache` (~20s) like the other list reads;
  the inbox stays live (`force-dynamic`) so just-arrived replies show.

## Testing
- `event-kinds.test.ts` — canonical + legacy kind → `{channel, action, direction}`; the
  positive-action set.
- `conversion.test.ts` — contacted/converted/rate math incl. the 0-contacted case and
  voice-interested counting.
- `inbox.test.ts` — timeline merge ordering across channels; channel filter; voice
  exclusion.

## Build order / decomposition
One coherent spec, two sequenced components:
1. **Unified inbox** — `event-kinds.ts` + `inbox.ts` + rework `/inbox` + `/inbox/[id]` +
   channel filter + the `Mark replied` control & `/api/leads/[id]/reply-log` route.
   (Core.)
2. **Per-campaign conversion** — `conversion.ts` + Campaigns sortable column.

## Out of scope (future)
- A separate monitoring **dashboard / live activity feed** (this spec is inbox-first; the
  same spine supports it later).
- **Sending** SMS replies in-app (needs the Mobivate key) and DM auto-send (Meta blocks it).
- The official **Meta Business API** integration for auto-capturing inbound DM replies.
