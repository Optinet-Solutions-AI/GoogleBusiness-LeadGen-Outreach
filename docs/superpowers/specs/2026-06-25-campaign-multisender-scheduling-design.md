# Campaign sending v2 — multi-sender rotation, randomized timezone-aware scheduling, country/category dropdowns, country-driven translation, campaign-grouped inbox

**Date:** 2026-06-25
**Status:** Approved (architecture) — pending spec review

## Problem

Operator wants campaign email sending to be safe and accurate:

1. **Many senders, anti-spam scheduling.** Pick multiple sending mailboxes per campaign; rotate across them; spread sends with randomized timing so it doesn't look botted.
2. **Follow-ups from the original sender.** Once a business is first emailed from mailbox A, every follow-up must come from A — never a different address — or the business is confused.
3. **Country dropdown** (not a free-text field), driving the send timezone and the translation language.
4. **Category dropdown** (not free-text), from the curated niche list.
5. **Operator-chosen send window** (days + start/end hour) in the **country's real timezone**.
6. **Auto-translation** of outreach into the selected country's language.
7. **Inbox grouped by campaign**, not by sender (sender is irrelevant to triage).

## Current state (what already exists)

- **Two email paths today:**
  - **Campaigns** (`/api/campaigns/[id]/launch`) send a *single* cold email per member via `stage-5-email` with one `sender_email`, warmup cap, kill-switch, idempotency, suppression.
  - **Sequence scheduler** (`lib/pipeline/sequence-scheduler.ts`) runs the 4-step screenshot-first ladder: per-lead enroll, **pins `seq_sender_email`**, paces via `seq_next_step_at`, enforces warmup caps + verification + suppression, and **auto-translates at send time** (`resolveLanguageCode` → `translateOutreachEmail`). Driven by Cloud Scheduler (`MODE=sequence`, ~every 15 min).
- `campaignTimezone(countryCode)` (`lib/call-hours.ts`) maps a country → IANA timezone (currently 7 countries: us, ca, gb, ie, au, nz, ph; unknown → UTC).
- `getSenderAccount(senderEmail?)` picks the first active mailbox; **rotation across multiple senders is explicitly "a later enhancement."** Per-account warmup-ramped daily cap is enforced from real 24h send history.
- Campaign wizard (`NewCampaignForm.tsx`): source/channel/segment, **country (text input)**, **category (text input)**, **single sender dropdown**, send days + start/end hour, with the window already labeled in `campaignTimezone(country)`.
- Inbox (`app/(dashboard)/inbox/page.tsx`) lists conversations sorted by recency; `campaign_leads(campaign_id, lead_id)` links leads to campaigns.

## Architecture decision

**Unify campaign email sending onto the sequence engine.** Creating/launching an email campaign **enrolls its members into the sequence ladder** rather than calling the single-shot `stage-5-email`. The sequence engine already provides pinned per-lead senders, follow-ups, pacing, warmup caps, verification, suppression, and translation — so we add only multi-sender rotation and timezone-window scheduling in one place.

*Alternative (rejected):* keep both paths and add features to each — duplicates deliverability-critical logic in two places.

## Components

### 1. Multi-sender rotation with pinned follow-ups
- `call_campaigns.sender_emails text[]` (multi-select). Keep `sender_email` as a single-value fallback / back-compat.
- **First send:** when a lead's step 1 is about to send and `seq_sender_email` is unset, pick a mailbox from the campaign's pool by **rotation that skips mailboxes at/over their warmup cap** (cap-aware round-robin; deterministic tiebreak by lead id so a re-run is stable). Persist it to `seq_sender_email`.
- **Follow-ups:** always reuse the pinned `seq_sender_email` (existing behavior). A business only ever hears from one address.
- If the pinned mailbox is later deleted, re-pin to another pool member (existing re-pin logic already handles a missing sender).

### 2. Randomized, timezone-aware scheduling
- Resolve the campaign's **send window** (`call_days`, `call_start_hour`, `call_end_hour`) in the **country timezone** (`campaignTimezone`).
- When scheduling the next step, compute `seq_next_step_at` = base interval (the existing 4-day ladder gap for follow-ups; ~immediate for step 1) **plus random jitter**, then **snap into the next valid window slot** in the campaign timezone. A send never lands outside the chosen days/hours of the prospect's timezone.
- Per-mailbox warmup daily cap still gates throughput (existing). Rotation + jitter + window = human-looking cadence.
- **Jitter parameters** live as named constants (e.g. min/max gap minutes) — not user-configurable in v1.

### 3. Country & category dropdowns
- **Country:** replace the text input with a `<select>` of the full country list (source: `lib/data/cities` country list). Expand `campaignTimezone`'s `COUNTRY_TZ` to cover all listed countries, and add a parallel `COUNTRY_LANG` map (country → ISO-639-1).
- **Category:** replace the text input with a `<select>` built from `NICHE_OPTIONS` (grouped by `NicheCategory`), value = the niche string the count/filter API already expects.

### 4. Country-driven auto-translation
- Send-time translation already runs. Extend `resolveLanguageCode` so the campaign/lead country resolves to a language via `COUNTRY_LANG`. Precedence unchanged: a per-lead **detected** language (from reviews) wins; otherwise fall back to the **country** language; otherwise English.

### 5. Inbox grouped by campaign
- Inbox groups/sorts conversations by **campaign** (join `campaign_leads`), with a campaign filter and section headers. Leads not in any campaign fall under an "Unassigned" group. Sender is not shown as a grouping key.

## Data model / migrations

- Migration: `alter table call_campaigns add column if not exists sender_emails text[];`
  - Backfill: `update call_campaigns set sender_emails = array[sender_email] where sender_email is not null and sender_emails is null;`
- No new columns needed on `leads` (`seq_sender_email`, `seq_next_step_at`, `seq_status`, `seq_step` already exist).
- Inbox reads `campaign_leads` for grouping.

## Flow

1. Operator creates an email campaign in the wizard: picks country (dropdown), category (dropdown), segment, **multiple mailboxes**, days + hour window.
2. Campaign create → enroll selected members into the sequence (`seq_status='active'`, `seq_step=0`). Membership is recorded in `campaign_leads`; the mailbox pool + window + country live on the `call_campaigns` row (not duplicated onto leads).
3. Sequence tick (Cloud Run `MODE=sequence`): for each due lead — **resolve the lead's campaign = its most-recent active `campaign_leads` membership**, read pool/window/tz/country from that campaign row; if unpinned, rotate-assign a mailbox (cap-aware) and pin; render + translate (country/lead language); send; schedule next step with jitter snapped into the window. A lead in **no** campaign (e.g. enrolled directly from the lead page) falls back to: all active mailboxes as the pool, the lead's own `country_code` for tz/language, and the global default window.
4. Replies/bounces stop the ladder (existing). Inbox shows the conversation grouped under its campaign.

## Error handling
- No mailbox in the pool under its cap → defer the lead to the next window (no send), same as the existing "capped" path.
- Unknown country → UTC timezone + English (existing fallback), logged.
- Pinned mailbox deleted → re-pin to a pool member; if pool empty, defer.
- Translation unavailable → send English (existing).

## Testing
- **Rotation** (pure): cap-aware round-robin picks the expected mailbox, skips capped ones, is deterministic per lead, and never exceeds a mailbox's cap.
- **Scheduling** (pure): jittered `seq_next_step_at` always lands inside the campaign window in the country timezone; out-of-window base times roll forward to the next valid slot; DST-safe via IANA tz.
- **Country maps** (pure): every country in the dropdown resolves to a timezone and a language; `resolveLanguageCode` precedence (lead-detected > country > English).
- Existing sequence-scheduler + spam-check + sequence-templates tests stay green.

## Phasing (for the implementation plan)
- **Phase 1 — send engine:** `sender_emails` migration, cap-aware rotation + pinned follow-ups, jittered timezone-window scheduling, unify campaign enroll onto the sequence. Tests.
- **Phase 2 — UI + reach:** country/category dropdowns, expanded `COUNTRY_TZ` + `COUNTRY_LANG`, country-driven translation, multi-mailbox multi-select in the wizard. Tests.
- **Phase 3 — inbox:** group/sort + filter by campaign.

## Out of scope (v1)
- Operator-configurable jitter values (use sane constants).
- SMS/DM rotation/scheduling (email only here; SMS stays on its queue).
- Per-mailbox per-campaign sub-caps beyond the existing warmup cap.
- Reworking the deprecated Instantly path.
