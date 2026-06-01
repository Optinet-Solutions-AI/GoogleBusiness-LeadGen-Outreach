# Campaign-based calling + 3-segment outreach — design

> Status: approved design (brainstorm 2026-06-01). Next: implementation plan.
> Supersedes the flat call-queue model; extends the voice-first integration plan
> (`C:\Users\User\.claude\plans\based-on-the-existing-generic-dragon.md`).

## Context / problem

Today the pipeline is `scrape → enrich → build → deploy → call`, the offer router **drops**
healthy-website leads (`qualified=false`, reason `good_website`), and `/calls` is a single flat
queue keyed off `stage='deployed'`. The operator wants to **run calling as campaigns** chosen by
**country + category + how many + day/time**, organized by **segment**, and to **call the
good-website leads too** (with a different script). Building should happen for **no-website only**.

## Goals
- Call leads as **named campaigns** the operator composes from scraped data.
- Three **segments**, derived from signals we already capture, each with its own script.
- **Build only Segment A** (no website). B & C call without a build.
- **Schedule** calls by day + local-time window, per campaign.
- Per-campaign **conversion + cost** (reuse `lib/analytics.ts`).

## Non-goals (deferred)
- The **improve (B) redesign-build** flow — its own later spec (criteria are computed now; the
  actual build is on hold).
- **Auto-dialing** + hard schedule/STOP/spend enforcement — Phase 2, via the integration plan
  (Vapi/Mobivate). This spec is **manual-calling** + the data model + UI.
- SMS one-time-link journey — integration plan.

## The three segments (derived at enrich, no new scraping)
| Seg | Condition (existing signals) | Build? | Script (voice-agent-trainer persona) |
|-----|------------------------------|--------|--------------------------------------|
| **A · no_website** | `has_website = false` | **Yes** (existing `buildLead`) → call references the demo | "Maya" build |
| **B · old_website** | `has_website` + `needs_improvement` (audit already run) | **No** (build on hold) | "Sam" improve — names the audited issues, offers to *make* a version |
| **C · has_website** | `has_website` + healthy site | **No** | NEW "discovery/menu" persona — they pick a service |

**Flow change:** in `stage-1-scrape.enrichOne` / `lib/offers.ts`, stop demoting healthy sites to
`qualified=false`. Instead set a new **`leads.call_segment`** (`no_website|old_website|has_website`)
on every kept lead and keep all three **callable**. `primary_offer` stays as today for A/B;
Segment C carries `call_segment='has_website'` with `primary_offer` left null (the menu script,
not a single pitch) and `secondary_offer='voice_agent'` as the usual attach. Segment A remains the
only segment eligible for the build step (operator-triggered `buildLead`, unchanged).

> Note: keeping good-website leads callable means they now count as qualified across existing
> dashboards — intended (we want to work them).

## Campaign model (new — lightweight)
A **campaign** is a saved calling job. Two new tables (migration `019`, additive, house style:
`if not exists` + `disable row level security`):

**`call_campaigns`**
`id`, `name`, `segment` check(`no_website|old_website|has_website`), `country_code`,
`category` (null = any), `batch_id` (null = any/all), `target_count` int,
`call_days int[]` (1=Mon..7=Sun), `call_start_hour` int, `call_end_hour` int, `timezone` (IANA,
derived from `country_code`), `status` check(`draft|building|active|paused|done`) default `draft`,
`created_at`.

**`campaign_leads`** (membership snapshot — fixes the count + tracks per-campaign progress)
`campaign_id` fk, `lead_id` fk, `status` check(`pending|called|interested|done|skipped`) default
`pending`, `added_at`; pk `(campaign_id, lead_id)`.

**Creation = snapshot:** `POST /api/campaigns` resolves the top `target_count` matching leads
(by `call_segment` + `country_code` + optional `category`/`batch_id`, freshest first, excluding
suppressed/DNC) and inserts `campaign_leads`. For Segment A it also kicks off background builds
(reuse `buildLead`, capped, **cost-previewed before confirm**) and sets `status='building'`→
`active`. B/C go straight to `active`.

## How "how many / day / time" works
- **How many:** `target_count` = the snapshot size (top-N freshest matching leads).
- **Day/time:** `call_days` + `call_start_hour..call_end_hour`, interpreted in **each lead's local
  time** via `timezone` mapped from `country_code` (reuse the `call-hours` config from the
  integration plan; `Intl.DateTimeFormat`). The campaign queue computes **"callable now"** per lead
  (today ∈ days AND local hour ∈ window) and **sorts callable-now to the top**; others show
  "opens <next window>". Manual calling now = advisory + sorting; the AI dialer (Phase 2) turns the
  same check into a hard gate. Default-safe: unknown tz → not callable-now (shown as "set country").

## Frontend (campaign-centric)
- **`/campaigns`** (new nav item, replaces flat `/calls` as the primary calling surface): campaign
  cards — name, segment, filters, schedule, "in window now?", and live progress
  (called → interested → finished from `lib/analytics.ts`, scoped to the campaign's `campaign_leads`).
- **New-campaign builder** (client form → `POST /api/campaigns`): segment → country → category →
  count → schedule (days + window) → name. Shows a **live match-count preview** and, for Segment A,
  an **estimated build cost** before confirm.
- **`/campaigns/[id]`** = the working call queue for that campaign: leads (callable-now first), the
  **segment's script**, phone, (A only) build/demo status, and the existing call controls
  (`/api/leads/[id]/call` + `/call/outcome`) which also update `campaign_leads.status`.
- **`/calls`** → "all open calls across campaigns" (or redirect to `/campaigns`).

## Segment-C "discovery/menu" persona (new)
Add to `skills/voice-agent-trainer/references/personas.md`: a human, <200-word persona for
good-site businesses — opens, asks what's working / not, offers the **service menu** (voice agent,
site refresh, etc.), lets them choose, isolates the need, books/notes interest. No build, no demo.

## API routes (new/changed)
- `POST /api/campaigns` (create + snapshot + optional A-build kickoff), `GET /api/campaigns`,
  `GET/PATCH /api/campaigns/[id]` (activate/pause/done).
- `GET /api/campaigns/[id]/metrics` (campaign-scoped analytics — extend `loadAnalytics` to accept a
  lead-id scope).
- Reuse `POST /api/leads/[id]/call` + `/call/outcome`; extend the outcome path to update
  `campaign_leads.status`.

## Reuse / touch-points
- `lib/analytics.ts` — add a campaign-scoped variant (filter by `campaign_leads.lead_id`).
- `lib/offers.ts` + `stage-1-scrape.enrichOne` — set `call_segment`; stop dropping good-website.
- `lib/call-hours.ts` (from integration plan) — the schedule/callable-now logic lives here.
- `components/SideNav.tsx` — add **Campaigns**.

## Phasing
- **Phase 1 (this plan):** `call_segment` + keep good-website callable; migration `019`
  (`call_campaigns`, `campaign_leads`); campaign builder + `/campaigns` list + `/campaigns/[id]`
  queue; scheduling + callable-now (advisory); Segment-C persona; per-campaign metrics. **Manual
  calling.**
- **Phase 2:** auto-dial per campaign + hard schedule/STOP/spend enforcement (integration plan,
  needs Voize/Vapi key).
- **Separate later spec:** Segment-B improve **redesign-build** flow.

## Verification (Phase 1, $0)
- Migration `019` applies clean; `call_segment` populated for A/B/C on a re-scraped batch; a
  good-website lead is now callable (not `qualified=false`).
- Create a campaign (segment + country + category + count + schedule) → `campaign_leads` snapshot
  has exactly N rows; `/campaigns` shows it with the right schedule + "in window?" state.
- Open `/campaigns/[id]` → callable-now leads sort first; out-of-window leads show next-window.
- Log a manual call outcome → `campaign_leads.status` + the campaign's metrics update.
- Segment A campaign shows build status + cost preview; B/C build nothing.
