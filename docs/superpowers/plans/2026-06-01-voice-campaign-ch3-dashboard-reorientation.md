# Voice-Campaign Chunk 3: Dashboard Reorientation — Implementation Plan

> Subagent-driven; verified with `npm run typecheck` + `npm run build`. Surgical edits to existing pages — keep them on-brand and don't break existing links.

**Goal:** Make the dashboard call-/campaign-first instead of email-first: nav becomes Today · Batches · Leads · Call queue · Campaigns · **Inbox** · Analytics · Status (no "Email accounts"); a reframed **`/inbox`** (interested calls + replies) replaces the email-era `/replies`; the **home** page shows call metrics + the voice funnel instead of email reply-rate.

**Architecture:** Server components reading via `safeDb` + `lib/analytics.loadAnalytics()`. Email data/routes are NOT deleted — only removed from the active UI (per spec + the integration plan: keep history). Reuse `MetricCard`, `FunnelChart`, `NeedsYouCard`, `StatCard`, `lib/analytics`.

Branch: `feat/voice-campaign-ch3` off `main`. No push.

Reference: `web/app/(dashboard)/page.tsx` (home), `web/app/(dashboard)/replies/page.tsx`, `web/components/SideNav.tsx`, `web/app/(dashboard)/analytics/page.tsx` (voice funnel mapping), `web/lib/analytics.ts` (`loadAnalytics()` → `CampaignAnalytics`).

---

### Task 1: Nav reshuffle + reframed `/inbox`

**Files:** Modify `web/components/SideNav.tsx`; Create `web/app/(dashboard)/inbox/page.tsx`; Modify `web/app/(dashboard)/replies/page.tsx` (→ redirect).

- **SideNav:** change the `/replies` entry to `{ href: "/inbox", label: "Inbox", icon: MessageSquareText }`. **Remove** the `/email-accounts` entry from PRIMARY (leave the route file intact — just drop the nav link). Keep everything else (Campaigns stays).
- **`/inbox` page** (server, `force-dynamic`, `isDbConfigured` guard): the human-owned queue of leads needing attention. Source = leads that are "warm":
  - leads with an **interested** call — query `call_attempts` `select("lead_id,created_at").eq("outcome","interested")` → distinct lead_ids; AND
  - leads at `stage = 'replied'` (legacy email replies, still valid signal).
  Fetch those leads (`leads.select(...).in("id",[...ids])` or fetch replied + interested separately and merge; cap ~500). Show a table (model on `replies/page.tsx` / `calls/page.tsx`): business + city, phone, segment badge (`LeadBadges`), why-it's-here chip ("Interested" green / "Replied" indigo), updated, row → `/leads/[id]`. Header: eyebrow "Outreach" + "Inbox" + a one-line subtitle ("Interested calls + replies to work"). Empty state: "Nothing waiting — interested calls and replies land here."
  - NOTE: SMS replies + form submissions will feed this inbox once those ship (integration plan) — add a `{/* + sms replies / form submissions when the journey ships */}` comment; don't build them now.
- **`/replies` route:** replace its content with a redirect to keep old links working: `import { redirect } from "next/navigation"; export default function Page(){ redirect("/inbox"); }` (and drop the now-unused imports). This avoids breaking any existing `/replies` links while the canonical route is `/inbox`.

Verify: `npm run typecheck` + `npm run build` (both `/inbox` and `/replies` compile). Commit `feat(web): reframe Replies → Inbox (interested calls + replies); drop Email accounts from nav`.

---

### Task 2: Call-first home page

**Files:** Modify `web/app/(dashboard)/page.tsx`.

Surgical reorientation — keep the layout/components, swap the email-era signals for call ones:
- Add `const analytics = await loadAnalytics();` (all-time voice funnel/rates) to the existing `fetchHomeData` flow (or call it alongside). 
- **Replace the "Reply rate" `MetricCard`** (which uses email `outreached→replied`) with a call metric from `analytics`: e.g. **"Interested"** (count from `analytics.funnel` key `interested`) or **"Connect rate"** (`analytics.rates.contact`), linking to `/inbox`. Remove the now-dead `replyRate*` / `outreached*` computations that only fed that card (leave anything still used elsewhere).
- **Replace the all-time stage `FunnelChart`** (scraped→…→won, email-shaped) with the **voice funnel** mapped from `analytics.funnel` exactly like `analytics/page.tsx` (`leads,called,interested,texted,clicked,finished`, with hrefs to /calls//campaigns//inbox). Keep the `FunnelChart` component; just feed it the voice stages.
- **"Needs You" / pipeline:** point the pipeline-value + replies references at `/inbox` (update `href="/replies"` → `/inbox`). The `NeedsYouCard` "replies" input can stay (it counts `stage='replied'`) but relabel conceptually as inbox items if trivial; otherwise leave the card as-is (low priority).
- Keep: sites-deployed, active batches, closed-this-month, spend cards, activity feed. (Actual call $ spend lands later with the live provider — leave the existing estimated spend card.)
- Don't break the page: it's large + polished; make minimal, correct edits and keep all remaining variables consistent (no unused-var or type errors).

Verify: `npm run typecheck` + `npm run build` (home `/` compiles). Commit `feat(web): call-first home — voice funnel + call metrics, links to /inbox`.

---

## Self-Review
- Coverage: nav (T1), /inbox (T1), /replies redirect (T1), call-first home (T2). Email accounts removed from nav (route kept). Email data/history untouched.
- Out of scope: SMS reply + form-submission inbox sources (integration plan); actual call $ spend on home (live provider). Both noted as comments, not built.
- Verify is typecheck + build. Watch for: unused-variable/type errors after stripping email computations from the home page; the `/replies` redirect dropping its old imports cleanly.

## Execution Handoff
Subagent-driven, typecheck+build gate per task, final review, merge to `main`. No push.
