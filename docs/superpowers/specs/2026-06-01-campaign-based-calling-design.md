# Voice-campaign dashboard — 3-segment calling, multi-source leads, multi-platform foundation

> Status: design in review (brainstorm 2026-06-01). Next: implementation plan.
> Supersedes the flat call-queue model + the email-era dashboard; extends the voice-first
> integration plan (`C:\Users\User\.claude\plans\based-on-the-existing-generic-dragon.md`).

## Context / problem

Today the pipeline is `scrape → enrich → build → deploy → call`, the offer router **drops**
healthy-website leads (`qualified=false`, reason `good_website`), and `/calls` is a single flat
queue keyed off `stage='deployed'`. The operator wants to **run calling as campaigns** chosen by
**country + category + how many + day/time**, organized by **segment**, and to **call the
good-website leads too** (with a different script). Building should happen for **no-website only**.

## Goals
- Call leads as **named campaigns** composed from **three sources**: the app (scraped), **CSV**, and
  **manual** entry.
- Three **segments**, derived from signals we already capture, each with its own script.
- **Build only Segment A** (no website). B & C call without a build.
- **Schedule** calls by day + local-time window, per campaign.
- Per-campaign **conversion + cost** (reuse `lib/analytics.ts`).
- **Reorient the whole dashboard** around voice campaigns — retire the email-era UI.
- A **provider- and source-agnostic foundation**: new voice/SMS platforms or lead sources plug in by
  implementing an interface, with no pipeline/UI/DB rewrite.

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
| **B · old_website** | `has_website` + `needs_improvement` (audit already run) | **No** (build on hold) | "Sam" improve — ONE static prompt; the audit only *segments* (no per-lead `{{issues}}` injected), Sam speaks to a dated site generically + offers to *make* a version |
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
`id`, `name`, `source` check(`app|csv|manual`) default `app`, `segment`
check(`no_website|old_website|has_website`), `country_code`, `category` (null = any), `batch_id`
(null = any/all), `target_count` int, `call_days int[]` (1=Mon..7=Sun), `call_start_hour` int,
`call_end_hour` int, `timezone` (IANA, derived from `country_code`),
`status` check(`draft|building|active|paused|done`) default `draft`, `created_at`.
(`country_code`/`category`/`batch_id`/`target_count` only apply when `source='app'`; CSV/manual
bring their own leads.)

**`campaign_leads`** (membership snapshot — fixes the count + tracks per-campaign progress)
`campaign_id` fk, `lead_id` fk, `status` check(`pending|called|interested|done|skipped`) default
`pending`, `added_at`; pk `(campaign_id, lead_id)`.

**Creation = snapshot** (`POST /api/campaigns`): see the three sources below. For **Segment A** it
also kicks off background builds (reuse `buildLead`, capped, **cost-previewed before confirm**) and
sets `status='building'`→`active`; B/C go straight to `active`.

## Lead sources (app / CSV / manual)
A campaign's leads come from one of three sources (the builder's first step). All three land as rows
in `leads` + `campaign_leads`, so the queue, scripts, scheduling, and metrics are **identical
downstream** — only intake differs.
1. **App (scraped)** — pick by `call_segment` + `country_code` + optional `category`/`batch_id`,
   newest first, up to `target_count`, excluding suppressed/DNC. Already carry segment + audit.
2. **CSV upload** — upload a file; **map columns** (required `phone`; optional `business_name`,
   `city`, `country`, `website_url`), normalize + validate phones, **dedupe** against existing leads,
   insert as `leads` (`source='csv'`) under a synthetic **import batch**. The operator **declares the
   segment** for the upload; if `website_url` is given we may run the existing audit to set
   `call_segment` automatically.
3. **Manual** — add leads by hand (business name + phone + optional city/country/website); same as
   CSV (`source='manual'`), segment operator-declared.

Shared intake lives in **`lib/leads/import.ts`** (validate → normalize phone to E.164 → dedupe →
insert). CSV/manual leads skip scrape/enrich; Segment-A CSV/manual leads can still be built on demand
via `buildLead`. **Migration `019` adds `leads.source`** (`scraped|csv|manual`, default `scraped`)
and an import batch is created per upload to keep batch-scoped views working.

## Foundation: provider- & source-agnostic (built to scale)
Design so adding a platform later is "implement an interface + register," never a rewrite — we must
not paint into a Vapi/Mobivate corner.
- **Channels behind interfaces.** Voice already uses `VoiceProvider` (`lib/services/voice/`,
  env-selected). SMS gets the same (`SmsProvider`). Any new dialer/text vendor — or a voice platform
  other than Vapi/Voize — implements the interface and registers in the factory; pipeline, routes,
  UI, and DB stay unchanged. Vendor-specific data lives in the `provider` (text) + `meta` (jsonb)
  columns we already have on `call_attempts` (and the new `sms_messages`), never in business logic.
- **Lead intake behind one importer.** `app`/`csv`/`manual` share the `lib/leads/import.ts` contract;
  a future source (another CRM, a partner API) is a new adapter, not new downstream code.
- **Agents are data, not code.** `voice_agents` rows (provider + assistant id + segment + version)
  mean new platforms/agents are *configured*, not hardcoded; scripts come from the
  `voice-agent-trainer` skill, not embedded per vendor.
- **DB is the source of truth; UI + metrics read generic shapes** (`leads`, `campaign_leads`,
  `call_attempts`, `sms_messages`, `outreach_events`) so they work for any platform that maps onto
  them. New channels add event `kind`s (free-text) — not migrations.
This just makes explicit the discipline already in `CLAUDE.md` (one provider per `lib/services/*`;
thin routes; DB as memory).

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
- **New-campaign builder** (client form → `POST /api/campaigns`): **source (app / CSV / manual)** →
  segment → [app: country → category → count] · [CSV: upload + column-map] · [manual: add rows] →
  schedule (days + window) → name. Shows a **live lead-count preview** and, for Segment A, an
  **estimated build cost** before confirm.
- **`/campaigns/[id]`** = the working call queue for that campaign: leads (callable-now first), the
  **segment's script**, phone, (A only) build/demo status, and the existing call controls
  (`/api/leads/[id]/call` + `/call/outcome`) which also update `campaign_leads.status`.
- **`/calls`** → "all open calls across campaigns" (or redirect to `/campaigns`).

## Dashboard revision (voice-campaign-first; retire email)
The dashboard still carries email-era surfaces that mislead a call operation. Reorient everything
around campaigns/calls; **keep email data/history but pull it from the active UI** (don't drop schema
— see the integration plan).
- **Nav (`SideNav`):** Today · Batches (scrape source) · Leads · **Campaigns** (was "Call queue") ·
  **Inbox** (was "Replies") · Analytics · Status. **Remove "Email accounts."**
- **Home (`/`):** swap email metrics for call ones — Connect rate · Interested · **Finished leads** ·
  **actual spend** (call + SMS) and cost/finished · in-window campaigns; the funnel becomes the voice
  funnel (lead → called → connected → interested → finished). "Needs You" = interested leads to follow
  up + campaigns in window.
- **Inbox (`/replies` → `/inbox`):** the human-owned queue from the integration plan — interested
  call outcomes, form submissions, and inbound SMS replies (incl. STOP) — not email replies.
- **Batch detail:** the email "Replies" stat → the voice funnel (already shipped in `lib/analytics`).
- **Leads list:** filter + badge by `call_segment`, `call_status`, and campaign; de-emphasize the
  email stages (`outreached` / `needs_email` / email `replied`).
- **Retire from active flow:** the `email-accounts` page + Instantly (service + webhook stay for
  history; schema untouched).

## Segment-C "discovery/menu" persona (new)
Add to `skills/voice-agent-trainer/references/personas.md`: a human, <200-word persona for
good-site businesses — opens, asks what's working / not, offers the **service menu** (voice agent,
site refresh, etc.), lets them choose, isolates the need, books/notes interest. No build, no demo.

## API routes (new/changed)
- `POST /api/campaigns` (create + snapshot + optional A-build kickoff), `GET /api/campaigns`,
  `GET/PATCH /api/campaigns/[id]` (activate/pause/done).
- `POST /api/leads/import` — CSV upload + column-map → validate/dedupe/insert (via `lib/leads/import`).
- `POST /api/leads` — manual add (single lead) via the same importer.
- `GET /api/campaigns/[id]/metrics` (campaign-scoped analytics — extend `loadAnalytics` to accept a
  lead-id scope).
- Reuse `POST /api/leads/[id]/call` + `/call/outcome`; extend the outcome path to update
  `campaign_leads.status`.

## Reuse / touch-points
- `lib/analytics.ts` — add a campaign-scoped variant (filter by `campaign_leads.lead_id`); home +
  inbox read from it.
- `lib/leads/import.ts` (new) — shared validate→normalize→dedupe→insert for app/CSV/manual; the
  source-agnostic seam.
- `lib/services/voice/` (`VoiceProvider`) + new `lib/services/sms/` (`SmsProvider`) — the
  platform-agnostic channel interfaces; vendors register in a factory.
- `lib/offers.ts` + `stage-1-scrape.enrichOne` — set `call_segment` + `leads.source`; stop dropping
  good-website.
- `lib/call-hours.ts` (from integration plan) — the schedule/callable-now logic lives here.
- `components/SideNav.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/replies` — the dashboard
  reorientation (Campaigns, Inbox, call-first home; remove Email accounts).

## Phasing
- **Phase 1 (this plan):** `call_segment` + `leads.source` + keep good-website callable; migration
  `019` (`call_campaigns`, `campaign_leads`); **3 lead sources** (app/CSV/manual via `lib/leads/import`);
  campaign builder + `/campaigns` list + `/campaigns/[id]` queue; scheduling + callable-now (advisory);
  **dashboard reorientation** (nav, call-first home, `/inbox`, retire email UI); Segment-C persona;
  per-campaign metrics. **Manual calling.**
- **Phase 2:** auto-dial per campaign + hard schedule/STOP/spend enforcement + the `SmsProvider`
  live channel (integration plan, needs Voize/Vapi + Mobivate keys).
- **Separate later spec:** Segment-B improve **redesign-build** flow.
- **Foundation throughout:** every channel/source behind an interface (above) so a new platform is an
  adapter, not a rewrite.

## Verification (Phase 1, $0)
- Migration `019` applies clean; `call_segment` + `leads.source` populated; a good-website lead is now
  callable (not `qualified=false`).
- **App source:** create a campaign (segment + country + category + count + schedule) → `campaign_leads`
  has exactly N rows; `/campaigns` shows schedule + "in window?".
- **CSV source:** upload a small CSV → leads imported (deduped, phones normalized) under an import
  batch with `source='csv'`, added to the campaign.
- **Manual source:** add one lead by hand → appears in the campaign.
- Open `/campaigns/[id]` → callable-now leads sort first; out-of-window show next-window.
- Log a manual call outcome → `campaign_leads.status` + campaign metrics update.
- Segment A campaign shows build status + cost preview; B/C build nothing.
- **Dashboard:** nav shows Campaigns + Inbox, no Email accounts; home shows call metrics (not reply
  rate); `/inbox` lists interested calls / form submits / SMS replies.
