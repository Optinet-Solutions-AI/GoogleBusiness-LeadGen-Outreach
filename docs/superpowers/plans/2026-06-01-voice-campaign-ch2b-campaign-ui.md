# Voice-Campaign Chunk 2b: Campaign UI — Implementation Plan

> **For agentic workers:** subagent-driven execution. UI tasks are verified with `npm run typecheck` + `npm run build` (no unit tests for pages). Follow EXISTING dashboard patterns.

**Goal:** The screens for the Chunk 2a campaign API — a `/campaigns` list, a New-Campaign builder (app/CSV/manual), and a `/campaigns/[id]` working call queue with callable-now sorting + a metrics strip.

**Architecture:** Server components read via `safeDb` (like `app/(dashboard)/batches/page.tsx`); the builder is a client component that POSTs to the Chunk 2a routes (`/api/leads`, `/api/leads/import`, `/api/campaigns`). Reuse existing UI: `StatCard`, `FunnelChart`, `StatusChip`, `StageChip`, `LeadBadges`, `MetricCard`, `lib/format.relativeTime`, `lib/data/cities.countryLabel`, `lib/call-hours.callableNow`, `lib/analytics.loadCampaignAnalytics`.

**Tech Stack:** Next.js 14 App Router, React server + client components, Tailwind (existing design tokens: `bg-surface`, `border-rule`, `editorial-head`, `eyebrow`, `text-ink*`, `mono-num`, `action`/`positive`/`warning`).

Reference files to match style: `web/app/(dashboard)/calls/page.tsx` (queue table), `web/app/(dashboard)/batches/page.tsx` + `batches/[id]/page.tsx` (list + detail + StatCard/FunnelChart), `web/components/SideNav.tsx`, `web/components/NewBatchButton.tsx` (client form + fetch pattern), `web/components/VoiceOutreachCard.tsx` (client actions).

Branch: `feat/voice-campaign-ch2b` off `main`. No push / no DB writes by the worker beyond what the UI triggers in dev.

---

### Task 1: `/campaigns` list page + nav entry

**Files:** Create `web/app/(dashboard)/campaigns/page.tsx`; Create `web/components/CampaignCard.tsx`; Modify `web/components/SideNav.tsx`.

- Server component. Fetch campaigns via `safeDb`: `db.from("call_campaigns").select("*").order("created_at",{ascending:false}).limit(200)`. For each campaign, fetch its member status counts (one query: `db.from("campaign_leads").select("campaign_id,status")` for all, group in JS by campaign_id) — or per-card. Keep it one or two queries total (avoid N+1).
- Render a header ("Campaigns") + a **"New campaign"** button (Task 2's client component) + a grid of `CampaignCard`s.
- `CampaignCard`: shows name, a segment badge (no_website/old_website/has_website → reuse the LeadBadges offer-tone styling or a simple chip), source, status chip (reuse `StatusChip`), schedule summary (`Mon–Fri 9–17` from `call_days`+hours), `timezone`, total members + a mini funnel (called → interested) from the status counts, and links to `/campaigns/[id]`.
- SideNav: add `{ href: "/campaigns", label: "Campaigns", icon: <pick a lucide icon e.g. Megaphone or PhoneOutgoing> }` to the PRIMARY array (import the icon). Place it right after "Call queue".
- Empty state when no campaigns: "No campaigns yet — create one to start calling."

Verify: `npm run typecheck` clean; `npm run build` succeeds (the `/campaigns` route compiles). Commit `feat(web): /campaigns list page + nav entry`.

---

### Task 2: New-campaign builder (client)

**Files:** Create `web/components/NewCampaignForm.tsx`; wire it into `web/app/(dashboard)/campaigns/page.tsx` (the "New campaign" button opens it — a modal or an inline expandable panel; follow `NewBatchButton.tsx`'s approach).

Client component (`"use client"`). A form with:
- **Source** toggle: App / CSV / Manual.
- **Common:** `name` (text), `segment` select (no_website | old_website | has_website), **schedule**: weekday checkboxes (Mon–Sun → `call_days` ints 1–7, default Mon–Fri) + `call_start_hour` / `call_end_hour` number inputs (default 9 / 20).
- **App source:** `country_code` (text, e.g. `us`), `category` (optional text), `target_count` (number).
- **CSV source:** a `<textarea>` to paste CSV text + a "first row is headers" assumption; after paste, parse headers client-side (split first line by comma) and show **mapping selects** for phone (required), business_name, city, country_code, website_url.
- **Manual source:** a small repeatable list of rows `{business_name, phone, city?}` with an "Add row" button (start with 1 row).

Submit logic (use `fetch`, show pending + error states like `NewBatchButton`):
- **App:** `POST /api/campaigns` with `{name, source:"app", segment, country_code, category?, target_count, call_days, call_start_hour, call_end_hour}`.
- **CSV:** first `POST /api/leads/import` with `{csv_text, mapping}` → get `lead_ids`; then `POST /api/campaigns` with `{name, source:"csv", segment, lead_ids, call_days, call_start_hour, call_end_hour}`.
- **Manual:** `POST /api/leads` for each row (collect `lead_id`s) — or sequentially; then `POST /api/campaigns` with `{name, source:"manual", segment, lead_ids, ...}`.
- On success: `router.refresh()` (next/navigation) to reload the list, close the form. On error: show the `error` from the `{success:false,error}` envelope.

Verify: `npm run typecheck` + `npm run build`. Commit `feat(web): new-campaign builder (app/CSV/manual)`.

---

### Task 3: `/campaigns/[id]` detail = working call queue

**Files:** Create `web/app/(dashboard)/campaigns/[id]/page.tsx`; Create `web/components/CampaignStatusActions.tsx` (client: pause/activate/done via PATCH).

- Server component. Fetch the campaign (`call_campaigns` by id; 404 via `notFound()` if missing). Fetch its members joined to leads: `db.from("campaign_leads").select("status,leads(id,business_name,phone,address,country_code,call_segment,call_status,stage,primary_offer,website_score,needs_improvement,website_kind,...)").eq("campaign_id", id)` — match the lead columns `LeadBadges` needs (see `calls/page.tsx` SELECT).
- Compute **callable-now** per lead with `callableNow({call_days, call_start_hour, call_end_hour, timezone}, new Date())` from `lib/call-hours` — but each lead's tz: use the campaign's `timezone` (campaign-level schedule). Sort callable-now leads first; show a "Callable now" green chip vs "Opens <window>" for others. (Use the campaign's tz; per-lead tz is later.)
- **Metrics strip** at top: call `loadCampaignAnalytics(id)` and show a compact set of `StatCard`s (Leads / Called / Interested / Finished) + reuse `FunnelChart` with the campaign funnel (map its `funnel` steps like `analytics/page.tsx` does) — or a lighter inline funnel. Keep it consistent with the `/analytics` page.
- **Queue table** (model on `calls/page.tsx`): business + city, phone, segment badge, call status, callable-now chip, and a row link to `/leads/[id]` (where the existing VoiceOutreachCard handles the actual call + script + outcome — reuse, don't rebuild calling).
- Header: campaign name + `CampaignStatusActions` (Pause/Activate/Mark done → `PATCH /api/campaigns/[id]` `{status}` then `router.refresh()`).

Verify: `npm run typecheck` + `npm run build`. Commit `feat(web): campaign detail call queue + status actions`.

---

## Self-Review
- Coverage: list + nav (T1), builder 3-source (T2), detail queue + metrics + status (T3). Calling itself reuses the existing lead-detail VoiceOutreachCard (no rebuild). Callable-now uses Chunk-2a `call-hours`. Metrics use Chunk-2a `loadCampaignAnalytics`.
- Out of scope (Chunk 3): home reorientation, `/inbox`, retire email nav. (SideNav gets the Campaigns entry here; the broader nav reshuffle is Chunk 3.)
- Verification is typecheck + build (UI). If `next build` fails on a server/client boundary (e.g., using `safeDb` in a client component, or an event handler in a server component), fix per Next.js rules (`"use client"` only where interactivity is needed; data-fetching stays server-side).

## Execution Handoff
Subagent-driven, one task at a time, typecheck+build gate each, final review, then merge to `main`. No push.
