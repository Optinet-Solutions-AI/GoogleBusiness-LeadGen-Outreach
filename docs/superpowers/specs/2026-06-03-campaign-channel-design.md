# Spec — Campaign outreach channel (2026-06-03)

## Goal
A campaign picks an outreach **channel** (Voice agent | SMS | DM | Email). Choosing it filters the
candidate leads to only those reachable that way (we classify every lead at scrape time), and shows
a live count of the eligible pool.

## Channel → eligibility (from fields captured at scrape time)
| Channel | Lead qualifies if… |
|---|---|
| Email | `email` is not null |
| SMS | `phone` is not null |
| Voice agent | `phone` is not null |
| DM | `website_kind` ∈ social set (facebook, instagram, twitter, linkedin, tiktok, pinterest, youtube, other_social) |

## Components
- **Migration 024** — `call_campaigns.channel text check (channel in ('voice_agent','sms','dm','email'))`
  (nullable; legacy rows stay null). Port to `db/schema.sql`.
- **`lib/campaigns/eligibility.ts`** — `Channel` type, `CHANNELS` (labels), `SOCIAL_KINDS`,
  `applyChannelEligibility(query, channel)` — applies the filter to a leads query (shared by the two routes).
- **`POST /api/campaigns`** — accept `channel` (required for app source instead of segment; segment now
  optional extra filter). App-source query filters by `applyChannelEligibility` + optional segment/
  country/category. Store `channel` on the campaign. CSV/manual just store the channel (they bring leads).
- **`GET /api/leads/count`** — `?channel=&segment=&country=&category=` → `{ count }` (Supabase head count)
  for the form's live "N leads match".
- **NewCampaignForm** — Channel picker (4 options) becomes the primary selector; Segment becomes an
  optional "Any" filter. App source shows the live eligible count. Sends `channel` (+ optional segment).
- **Campaigns list** — show the channel per campaign.

## Notes / scope
- Voice agent is selectable for organizing, but live dialing stays parked (needs phone numbers).
- This is selection + classification only; actually sending via the channel reuses the existing
  per-channel stages / bulk send (separate, already built). Migration 024 must be applied before
  channel campaigns can be created.
