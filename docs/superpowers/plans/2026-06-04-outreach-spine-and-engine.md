# Outreach Spine & Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "pick leads on the Leads page → Add to campaign (one channel) → Launch" the single way to send, replacing the leads-page "Send via best channel" bulk action and the wizard's count-snapshot.

**Architecture:** Selection happens on the Leads workbench (multi-select + "select all matching"). An `AddToCampaignDialog` filters the selection to channel-reachable, non-suppressed, non-duplicate leads and writes membership to a new or existing campaign (reusing `call_campaigns` + `campaign_leads`). Email/SMS campaigns Launch in capped batches (reusing `stage-5-email` / `stage-6-sms` + their guards); voice/DM campaigns surface their members as a work-queue. Pure logic (channel reachability, member partitioning) is unit-tested with vitest; routes + UI are verified with `typecheck`/`lint`/manual, matching the codebase.

**Tech Stack:** Next.js 14 (App Router, server + `"use client"`), Supabase (`getDb`/`safeDb`), zod, Tailwind (monochrome design tokens), vitest. Helpers: `lib/api-wrap.ts` (`withApi`), `lib/response.ts` (`ok`/`fail`), `lib/suppression.ts` (`isSuppressed`), `lib/campaigns/eligibility.ts`.

**Git:** Each task ends with a **local** commit. Do **not** `git push` (push = Vercel deploy) without explicit operator approval.

---

## Testing Approach

- **Unit-test (vitest, TDD)** the pure functions: `isReachable(lead, channel)` and `partitionForChannel(...)`. Test files sit next to source as `*.test.ts`. Run a single file with:
  `npm --prefix web run test -- <relative/path.test.ts>`
- **Routes + components** are verified with `npm --prefix web run typecheck` + `npm --prefix web run lint` + a one-line manual check (the codebase has no route/component test harness; don't invent one here).

---

## File Structure

**Create:**
- `web/lib/campaigns/reachability.ts` — pure `isReachable(lead, channel)` + `partitionForChannel(leads, channel)` (eligible vs skip-reason). One responsibility: "is this lead reachable on this channel."
- `web/lib/campaigns/reachability.test.ts` — vitest unit tests for the above.
- `web/lib/campaigns/add-members.ts` — `addMembers(db, campaign, leadIds)`: load leads, partition by `campaign.channel`, drop suppressed + duplicates, insert `campaign_leads`, return `{ added, skipped }`. Shared by both add paths.
- `web/app/api/campaigns/[id]/leads/route.ts` — `POST` add selected leads to an existing campaign.
- `web/app/api/campaigns/[id]/launch/route.ts` — `POST` send pending members of an email/SMS campaign within the daily cap.
- `web/app/api/leads/ids/route.ts` — `GET` matching lead ids for the current filter (powers "select all N matching").
- `web/components/AddToCampaignDialog.tsx` — the channel + new/existing dialog.

**Modify:**
- `web/app/api/campaigns/route.ts` — accept explicit `lead_ids` for `source:'app'` (create-with-selection); route insertion through `addMembers`.
- `web/components/LeadsTable.tsx` — replace the "Send via best channel" action bar + preview modal with multi-select + "Add to campaign" (+ "select all N matching"); remove the route-send wiring.
- `web/app/(dashboard)/leads/page.tsx` — pass the active filter (stage/search) to `LeadsTable` so "select all matching" + the dialog know the filter; expose the total matching count.
- `web/app/(dashboard)/campaigns/[id]/page.tsx` — channel-aware detail: a **Launch** control + send-progress for email/SMS; a member work-queue for voice/DM.

**Remove (after the new path works):**
- `web/components/LeadActions`? No — unrelated. Only remove dead send wiring: the bulk-send `call/openPreview/confirmSend` block in `LeadsTable.tsx` and stop importing `route-send`. Leave `web/app/api/leads/send/route.ts` + `web/lib/outreach/route-send.ts` in place but unreferenced (delete in a final cleanup task).

---

## Task 1: Pure channel-reachability helper (TDD)

**Files:**
- Create: `web/lib/campaigns/reachability.ts`
- Test: `web/lib/campaigns/reachability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/campaigns/reachability.test.ts
import { describe, it, expect } from "vitest";
import { isReachable, partitionForChannel } from "./reachability";

const lead = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "L1",
  email: null as string | null,
  phone: null as string | null,
  website_kind: null as string | null,
  ...over,
});

describe("isReachable", () => {
  it("email needs an email", () => {
    expect(isReachable(lead({ email: "a@b.com" }), "email")).toBe(true);
    expect(isReachable(lead({ email: null }), "email")).toBe(false);
  });
  it("sms + voice need a phone", () => {
    expect(isReachable(lead({ phone: "+1555" }), "sms")).toBe(true);
    expect(isReachable(lead({ phone: "+1555" }), "voice_agent")).toBe(true);
    expect(isReachable(lead({ phone: null }), "sms")).toBe(false);
  });
  it("dm needs a social website_kind", () => {
    expect(isReachable(lead({ website_kind: "instagram" }), "dm")).toBe(true);
    expect(isReachable(lead({ website_kind: "real" }), "dm")).toBe(false);
  });
});

describe("partitionForChannel", () => {
  it("splits eligible vs not_reachable", () => {
    const leads = [
      lead({ id: "A", email: "a@b.com" }),
      lead({ id: "B", email: null }),
    ];
    const { eligible, skipped } = partitionForChannel(leads, "email");
    expect(eligible.map((l) => l.id)).toEqual(["A"]);
    expect(skipped.not_reachable).toEqual(["B"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix web run test -- lib/campaigns/reachability.test.ts`
Expected: FAIL — `isReachable`/`partitionForChannel` not exported.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/campaigns/reachability.ts
/**
 * reachability.ts — pure "can we reach this lead on this channel?" logic.
 * Mirrors applyChannelEligibility (the DB-query version) for in-memory checks.
 */
import { SOCIAL_KINDS, type Channel } from "./eligibility";

export interface ReachableLead {
  id: string;
  email: string | null;
  phone: string | null;
  website_kind: string | null;
}

export function isReachable(lead: ReachableLead, channel: Channel): boolean {
  switch (channel) {
    case "email":
      return !!lead.email;
    case "sms":
    case "voice_agent":
      return !!lead.phone;
    case "dm":
      return !!lead.website_kind && SOCIAL_KINDS.includes(lead.website_kind);
    default:
      return false;
  }
}

export function partitionForChannel<L extends ReachableLead>(
  leads: L[],
  channel: Channel,
): { eligible: L[]; skipped: { not_reachable: string[] } } {
  const eligible: L[] = [];
  const not_reachable: string[] = [];
  for (const l of leads) {
    if (isReachable(l, channel)) eligible.push(l);
    else not_reachable.push(l.id);
  }
  return { eligible, skipped: { not_reachable } };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix web run test -- lib/campaigns/reachability.test.ts`
Expected: PASS (3 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/campaigns/reachability.ts web/lib/campaigns/reachability.test.ts
git commit -m "feat(campaign): pure channel-reachability helper + tests"
```

---

## Task 2: Shared `addMembers` helper

**Files:**
- Create: `web/lib/campaigns/add-members.ts`

- [ ] **Step 1: Write the implementation**

```ts
// web/lib/campaigns/add-members.ts
/**
 * add-members.ts — add selected leads to a campaign as members.
 *
 * Filters the given lead_ids to those reachable on the campaign's channel, drops
 * suppressed leads + ones already in the campaign, inserts campaign_leads rows.
 * Returns a breakdown so the UI can report what was added vs skipped + why.
 * Used by: POST /api/campaigns (create-with-leads) + POST /api/campaigns/[id]/leads.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReachable, type ReachableLead } from "./reachability";
import type { Channel } from "./eligibility";
import { isSuppressed } from "../suppression";

const SUPPRESSION_CHANNEL: Record<Channel, "voice" | "sms" | "email"> = {
  voice_agent: "voice",
  sms: "sms",
  dm: "sms", // no dedicated DM suppression channel; treat as sms-class for STOP
  email: "email",
};

export interface AddMembersResult {
  added: number;
  skipped: { not_reachable: number; suppressed: number; already_member: number };
}

interface LeadRow extends ReachableLead {
  lifecycle_stage: string | null;
}

export async function addMembers(
  db: SupabaseClient,
  campaign: { id: string; channel: Channel },
  leadIds: string[],
): Promise<AddMembersResult> {
  const result: AddMembersResult = {
    added: 0,
    skipped: { not_reachable: 0, suppressed: 0, already_member: 0 },
  };
  if (leadIds.length === 0) return result;

  // Load the candidate leads (only the columns reachability + suppression need).
  const { data: leadsData } = await db
    .from("leads")
    .select("id,email,phone,website_kind,lifecycle_stage")
    .in("id", leadIds)
    .limit(20000);
  const leads = (leadsData ?? []) as LeadRow[];

  // Already-members of this campaign (dedupe).
  const { data: existing } = await db
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", campaign.id)
    .in("lead_id", leadIds)
    .limit(20000);
  const alreadyMember = new Set((existing ?? []).map((r: { lead_id: string }) => r.lead_id));

  const toInsert: string[] = [];
  for (const lead of leads) {
    if (alreadyMember.has(lead.id)) {
      result.skipped.already_member += 1;
      continue;
    }
    if (!isReachable(lead, campaign.channel)) {
      result.skipped.not_reachable += 1;
      continue;
    }
    if (await isSuppressed(lead, SUPPRESSION_CHANNEL[campaign.channel])) {
      result.skipped.suppressed += 1;
      continue;
    }
    toInsert.push(lead.id);
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((lead_id) => ({ campaign_id: campaign.id, lead_id }));
    const { error } = await db.from("campaign_leads").insert(rows);
    if (error) throw new Error(`membership insert failed: ${error.message}`);
    result.added = toInsert.length;
  }
  return result;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm --prefix web run typecheck`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add web/lib/campaigns/add-members.ts
git commit -m "feat(campaign): shared addMembers (eligibility + suppression + dedupe)"
```

---

## Task 3: API — add leads to an existing campaign

**Files:**
- Create: `web/app/api/campaigns/[id]/leads/route.ts`

- [ ] **Step 1: Write the route**

```ts
// web/app/api/campaigns/[id]/leads/route.ts
/**
 * POST /api/campaigns/[id]/leads — add selected leads to an existing campaign.
 * Body: { lead_ids: string[] } → { added, skipped }.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { addMembers } from "@/lib/campaigns/add-members";
import type { Channel } from "@/lib/campaigns/eligibility";

export const dynamic = "force-dynamic";

const Body = z.object({ lead_ids: z.array(z.string().uuid()).min(1).max(5000) });

export const POST = withApi(async (req, { params }: { params: { id: string } }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const db = getDb();
  const { data: camp, error } = await db
    .from("call_campaigns")
    .select("id,channel")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return fail(error.message, 502);
  if (!camp) return fail("Campaign not found", 404);
  if (!camp.channel) return fail("Campaign has no channel", 400);

  const result = await addMembers(db, { id: camp.id, channel: camp.channel as Channel }, parsed.data.lead_ids);
  return ok(result);
});
```

- [ ] **Step 2: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean (only the pre-existing VapiTestCall warning).

- [ ] **Step 3: Commit**

```bash
git add web/app/api/campaigns/[id]/leads/route.ts
git commit -m "feat(api): add leads to an existing campaign"
```

---

## Task 4: API — create a campaign from an explicit selection

**Files:**
- Modify: `web/app/api/campaigns/route.ts`

- [ ] **Step 1: Generalize the POST to accept lead_ids for `source:'app'`**

In `web/app/api/campaigns/route.ts`, the app-source branch currently requires `channel + target_count` and runs `selectSnapshot`. Replace the lead-id resolution so an explicit `lead_ids` selection wins, and route membership insertion through `addMembers`. Find the block:

```ts
  // Resolve the snapshot lead-id list.
  let leadIds: string[] = [];
  if (b.source === "app") {
    if (!b.channel || !b.target_count) return fail("app source needs channel + target_count", 400);
    let q = db
      .from("leads")
      .select("id,created_at,lifecycle_stage")
      .neq("qualified", false)
      .limit(20000);
    q = applyChannelEligibility(q, b.channel);
    if (b.segment) q = q.eq("call_segment", b.segment);
    if (b.country_code) q = q.eq("country_code", b.country_code.toLowerCase());
    if (b.category) q = q.eq("category", b.category);
    const { data: cands, error } = await q;
    if (error) return fail(`lead query failed: ${error.message}`, 502);
    leadIds = selectSnapshot((cands ?? []) as Candidate[], b.target_count);
  } else {
    if (!b.lead_ids?.length) return fail(`${b.source} source needs lead_ids`, 400);
    leadIds = b.lead_ids;
  }
  if (leadIds.length === 0) return fail("No matching leads to snapshot", 400);
```

Replace with (explicit `lead_ids` is the new default path; `target_count` snapshot kept as fallback):

```ts
  // Resolve the membership lead-id list. Explicit selection wins; the old
  // target_count snapshot remains as a fallback for app source without ids.
  if (!b.channel) return fail("channel is required", 400);
  let leadIds: string[] = [];
  if (b.lead_ids?.length) {
    leadIds = b.lead_ids;
  } else if (b.source === "app" && b.target_count) {
    let q = db
      .from("leads")
      .select("id,created_at,lifecycle_stage")
      .neq("qualified", false)
      .limit(20000);
    q = applyChannelEligibility(q, b.channel);
    if (b.segment) q = q.eq("call_segment", b.segment);
    if (b.country_code) q = q.eq("country_code", b.country_code.toLowerCase());
    if (b.category) q = q.eq("category", b.category);
    const { data: cands, error } = await q;
    if (error) return fail(`lead query failed: ${error.message}`, 502);
    leadIds = selectSnapshot((cands ?? []) as Candidate[], b.target_count);
  } else {
    return fail("provide lead_ids (or target_count for an app snapshot)", 400);
  }
  if (leadIds.length === 0) return fail("No leads selected", 400);
```

- [ ] **Step 2: Replace the raw membership insert with `addMembers`**

Find:

```ts
  const membership = leadIds.map((lead_id) => ({ campaign_id: (camp as { id: string }).id, lead_id }));
  const { error: mErr } = await db.from("campaign_leads").insert(membership);
  if (mErr) return fail(`membership insert failed: ${mErr.message}`, 502);

  return ok({ campaign: camp, snapshot_count: leadIds.length });
```

Replace with:

```ts
  const added = await addMembers(
    db,
    { id: (camp as { id: string }).id, channel: b.channel },
    leadIds,
  );
  return ok({ campaign: camp, ...added });
```

- [ ] **Step 3: Add the import**

At the top of the file, add:

```ts
import { addMembers } from "@/lib/campaigns/add-members";
```

(Keep the existing `selectSnapshot` / `applyChannelEligibility` imports — still used by the fallback.)

- [ ] **Step 4: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/campaigns/route.ts
git commit -m "feat(api): create campaign from an explicit lead selection"
```

---

## Task 5: API — matching lead ids (for "select all N matching")

**Files:**
- Create: `web/app/api/leads/ids/route.ts`

- [ ] **Step 1: Write the route**

```ts
// web/app/api/leads/ids/route.ts
/**
 * GET /api/leads/ids?stage=&q= — just the ids of leads matching the Leads-page
 * filter, so "select all N matching" can span the whole set (not just the page).
 * Pure read. Mirrors the filter in (dashboard)/leads/page.tsx getLeads().
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST_LIMIT = 5000;

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") ?? undefined;

  let q = getDb().from("leads").select("id").order("updated_at", { ascending: false }).limit(POST_LIMIT);
  if (stage) q = q.eq("stage", stage);

  const { data, error } = await q;
  if (error) return fail(error.message, 502);
  return ok({ ids: (data ?? []).map((r: { id: string }) => r.id) });
});
```

- [ ] **Step 2: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/leads/ids/route.ts
git commit -m "feat(api): matching lead-id list for select-all"
```

---

## Task 6: `AddToCampaignDialog` component

**Files:**
- Create: `web/components/AddToCampaignDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/AddToCampaignDialog.tsx
"use client";

/**
 * AddToCampaignDialog.tsx — pick a channel + a new/existing campaign, then add
 * the selected leads. Reports added vs skipped (not reachable / suppressed / dup).
 * Used by: components/LeadsTable.tsx (the "Add to campaign" action).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { CHANNELS, type Channel } from "@/lib/campaigns/eligibility";

interface ExistingCampaign { id: string; name: string; channel: string | null }
interface AddResult { added: number; skipped: { not_reachable: number; suppressed: number; already_member: number } }

export function AddToCampaignDialog({
  leadIds,
  onClose,
  onDone,
}: {
  leadIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState<ExistingCampaign[]>([]);
  const [existingId, setExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing campaigns of the chosen channel for the "add to existing" picker.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ campaigns: ExistingCampaign[] }>("/api/campaigns").then((r) => {
      if (cancelled || !r.success) return;
      setExisting(r.data.campaigns.filter((c) => c.channel === channel));
      setExistingId("");
    });
    return () => { cancelled = true; };
  }, [channel]);

  async function submit() {
    setError(null);
    setBusy(true);
    let res;
    if (mode === "existing") {
      if (!existingId) { setError("Pick a campaign."); setBusy(false); return; }
      res = await fetchJson<AddResult>(`/api/campaigns/${existingId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_ids: leadIds }),
      });
    } else {
      if (!name.trim()) { setError("Name the campaign."); setBusy(false); return; }
      res = await fetchJson<{ added: number; skipped: AddResult["skipped"] }>("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), source: "app", channel, lead_ids: leadIds }),
      });
    }
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    const r = res.data as AddResult;
    const skip = r.skipped.not_reachable + r.skipped.suppressed + r.skipped.already_member;
    toast.success(`${r.added} added${skip ? `, ${skip} skipped` : ""}.`, { title: "Added to campaign" });
    router.refresh();
    onDone();
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <section className="bg-white w-full max-w-[460px] rounded-xl border border-rule shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center">
          <h2 className="text-[15px] font-semibold text-ink">Add {leadIds.length} lead{leadIds.length === 1 ? "" : "s"} to a campaign</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-subtle hover:text-ink transition-colors"><X className="h-5 w-5" /></button>
        </header>

        <div className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Channel</label>
            <div className="grid grid-cols-2 gap-1.5">
              {CHANNELS.map((c) => (
                <button key={c.value} type="button" onClick={() => setChannel(c.value)}
                  className={["px-3 py-2 rounded-lg text-[12px] font-semibold border text-left transition-colors",
                    channel === c.value ? "bg-ink text-canvas border-ink" : "bg-surface-alt border-rule text-ink-muted hover:text-ink"].join(" ")}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-muted">Only the selected leads reachable by {CHANNELS.find((c) => c.value === channel)?.label} are added; the rest are skipped.</p>
          </div>

          <div className="flex gap-1 p-1 bg-surface-alt rounded-lg border border-rule">
            <button type="button" onClick={() => setMode("new")} className={["flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors", mode === "new" ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"].join(" ")}>New campaign</button>
            <button type="button" onClick={() => setMode("existing")} className={["flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors", mode === "existing" ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"].join(" ")}>Existing</button>
          </div>

          {mode === "new" ? (
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" autoFocus
              className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none" />
          ) : (
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)}
              className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white">
              <option value="">{existing.length ? "Select a campaign…" : "No campaigns on this channel yet"}</option>
              {existing.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex items-center justify-between gap-3">
          <p className="text-[12px] text-urgent font-medium min-h-[16px] flex-1 truncate">{error ?? ""}</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="button" onClick={submit} loading={busy}>Add to campaign</Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/components/AddToCampaignDialog.tsx
git commit -m "feat(leads): AddToCampaignDialog (channel + new/existing)"
```

---

## Task 7: Leads page — wire selection + filter into the table

**Files:**
- Modify: `web/app/(dashboard)/leads/page.tsx`

- [ ] **Step 1: Pass the active stage + total count to the table**

`getLeads(stage)` already filters by `stage`. Add a total count and pass `stage` to `LeadsTable`. Change the render in `LeadsPage` from `<LeadsTable leads={leads} />` to:

```tsx
        <LeadsTable leads={leads} activeStage={activeStage ?? null} totalCount={leads.length} />
```

(Note: `totalCount` is the loaded count today — the leads query caps at 200. "Select all matching" beyond 200 uses `/api/leads/ids` in Task 8. Keeping `totalCount = leads.length` is correct for the common case; the ids endpoint handles the overflow.)

- [ ] **Step 2: Verify type-check**

Run: `npm --prefix web run typecheck`
Expected: FAIL until Task 8 adds the new `LeadsTable` props — that's expected; proceed to Task 8 before re-running.

- [ ] **Step 3: Commit** (after Task 8 type-checks)

Defer the commit to the end of Task 8 (these two changes are one logical unit).

---

## Task 8: Leads table — replace bulk-send with "Add to campaign"

**Files:**
- Modify: `web/components/LeadsTable.tsx`

- [ ] **Step 1: Update the props + state**

Change the component signature and remove the route-send state. Replace:

```tsx
export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
```

with:

```tsx
export function LeadsTable({
  leads,
  activeStage,
  totalCount,
}: {
  leads: LeadRow[];
  activeStage: string | null;
  totalCount: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
```

Delete the `Summary`/`Phase` interfaces/types and the `call`/`openPreview`/`confirmSend` functions and the preview modal JSX (the whole `{preview && (...)}` block) — they belong to the old send flow.

- [ ] **Step 2: Add the import + an "Add to campaign" action bar + select-all-matching**

Add at the top:

```tsx
import { AddToCampaignDialog } from "@/components/AddToCampaignDialog";
import { fetchJson } from "@/lib/fetch-json";
```

Replace the old action-bar block with:

```tsx
      {selected.size > 0 && (
        <div className="bg-surface border border-rule rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 sticky top-2 z-10">
          <div className="text-[13px] text-ink">
            <span className="mono-num font-semibold">{selected.size}</span> selected
            {selected.size < totalCount && (
              <button
                type="button"
                onClick={selectAllMatching}
                disabled={selectingAll}
                className="ml-3 text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
              >
                {selectingAll ? "Selecting…" : `Select all ${totalCount}`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Button size="sm" onClick={() => setDialogOpen(true)}>Add to campaign</Button>
            <button onClick={() => setSelected(new Set())} className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink bg-transparent border-0 p-0 cursor-pointer">Clear</button>
          </div>
        </div>
      )}
```

Add the `selectAllMatching` function inside the component:

```tsx
  async function selectAllMatching() {
    setSelectingAll(true);
    const params = new URLSearchParams();
    if (activeStage) params.set("stage", activeStage);
    const res = await fetchJson<{ ids: string[] }>(`/api/leads/ids?${params.toString()}`);
    setSelectingAll(false);
    if (res.success) setSelected(new Set(res.data.ids));
  }
```

- [ ] **Step 3: Mount the dialog**

Before the closing `</div>` of the component's return, add:

```tsx
      {dialogOpen && (
        <AddToCampaignDialog
          leadIds={[...selected]}
          onClose={() => setDialogOpen(false)}
          onDone={() => { setDialogOpen(false); setSelected(new Set()); }}
        />
      )}
```

- [ ] **Step 4: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean (Task 7 + 8 now consistent). If `useRouter`/`Link` become unused, remove those imports.

- [ ] **Step 5: Manual check**

Start dev (`npm --prefix web run dev`), open `/leads`, tick 2 rows → "Add to campaign" → New, channel Email, name "Test" → Add. Expect a toast "N added…". Open `/campaigns` → the campaign shows the member count.

- [ ] **Step 6: Commit**

```bash
git add web/components/LeadsTable.tsx "web/app/(dashboard)/leads/page.tsx"
git commit -m "feat(leads): replace bulk-send with Add to campaign + select-all"
```

---

## Task 9: Campaign Launch API (email/SMS, capped)

**Files:**
- Create: `web/app/api/campaigns/[id]/launch/route.ts`

- [ ] **Step 1: Write the route**

```ts
// web/app/api/campaigns/[id]/launch/route.ts
/**
 * POST /api/campaigns/[id]/launch — send pending members of an email/SMS campaign.
 * Reuses the per-lead senders (stage-5-email / stage-6-sms) + their guards (cap,
 * kill-switch, suppression). Capped batch: stops when a send returns paused/capped.
 * Voice/DM campaigns are worked from the campaign detail queue, not launched here.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { run as runEmail, type EmailLead } from "@/lib/pipeline/stage-5-email";
import { run as runSms } from "@/lib/pipeline/stage-6-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 100; // hard ceiling per call; cap/kill-switch stop us earlier

export const POST = withApi(async (_req, { params }: { params: { id: string } }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();

  const { data: camp } = await db
    .from("call_campaigns")
    .select("id,channel,status")
    .eq("id", params.id)
    .maybeSingle();
  if (!camp) return fail("Campaign not found", 404);
  if (camp.channel !== "email" && camp.channel !== "sms") {
    return fail("Only email/SMS campaigns can be launched; voice/DM are worked from the queue.", 400);
  }

  // Pending members joined to the lead fields the senders need.
  const { data: members } = await db
    .from("campaign_leads")
    .select("lead_id,status,leads(id,business_name,email,phone,primary_offer,lifecycle_stage,demo_url)")
    .eq("campaign_id", camp.id)
    .eq("status", "pending")
    .limit(BATCH);

  let sent = 0;
  let held = 0;
  let skipped = 0;
  for (const m of (members ?? []) as Array<{ lead_id: string; leads: EmailLead | null }>) {
    const lead = m.leads;
    if (!lead) { skipped += 1; continue; }
    const res = camp.channel === "email" ? await runEmail(lead) : await runSms(lead as never);
    if (res.skipped === "paused" || res.skipped === "capped") { held += 1; break; }
    if (res.sent) {
      sent += 1;
      await db.from("campaign_leads").update({ status: "sent" }).eq("campaign_id", camp.id).eq("lead_id", m.lead_id);
    } else {
      skipped += 1;
    }
  }

  await db.from("call_campaigns").update({ status: "active" }).eq("id", camp.id);
  return ok({ sent, held, skipped });
});
```

> Note for the implementer: confirm `stage-6-sms`'s exported `run` + its lead shape; if its signature differs from `EmailLead`, adapt the `runSms` call (the cast `as never` is a placeholder to force you to check — replace with the real `SmsLead` type). Keep both senders' return shape `{ sent, skipped? }`.

- [ ] **Step 2: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean after you wire the real `stage-6-sms` lead type (remove the `as never`).

- [ ] **Step 3: Commit**

```bash
git add web/app/api/campaigns/[id]/launch/route.ts
git commit -m "feat(api): launch email/SMS campaign within caps"
```

---

## Task 10: Campaign detail — Launch button / work-queue

**Files:**
- Modify: `web/app/(dashboard)/campaigns/[id]/page.tsx`

- [ ] **Step 1: Add a channel-aware action + member status**

Read the current detail page first. Add, near the campaign header, a client control:
- If `channel ∈ {email, sms}` → a **"Launch"** button (client component `LaunchCampaignButton` that POSTs `/api/campaigns/[id]/launch`, toasts `{sent, held, skipped}`, `router.refresh()`).
- If `channel ∈ {voice_agent, dm}` → a short note "Work these from the queue below" (the member list already serves as the queue; per-lead actions are the existing call/DM flows).

Create `web/components/LaunchCampaignButton.tsx`:

```tsx
"use client";
/** LaunchCampaignButton.tsx — send an email/SMS campaign's pending members (capped). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function LaunchCampaignButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function launch() {
    setBusy(true);
    const res = await fetchJson<{ sent: number; held: number; skipped: number }>(`/api/campaigns/${id}/launch`, { method: "POST" });
    setBusy(false);
    if (!res.success) { toast.error(res.error, { title: "Launch failed" }); return; }
    const { sent, held } = res.data;
    toast.success(sent > 0 ? `Sent ${sent}${held ? ` · ${held} held for the cap` : ""}.` : held ? "Nothing sent — daily cap reached." : "Nothing pending to send.");
    router.refresh();
  }
  return (
    <Button variant="primary" onClick={launch} loading={busy}>
      {!busy && <Send strokeWidth={2} />} Launch send
    </Button>
  );
}
```

Then in `campaigns/[id]/page.tsx`, import it and render conditionally on the campaign's channel (use the campaign row already fetched on that page):

```tsx
import { LaunchCampaignButton } from "@/components/LaunchCampaignButton";
// ...in the header actions area:
{(campaign.channel === "email" || campaign.channel === "sms") && (
  <LaunchCampaignButton id={campaign.id} />
)}
```

- [ ] **Step 2: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

- [ ] **Step 3: Manual check**

On a connected mailbox (or with email soft-no-op), open an email campaign with pending members → Launch → toast reports sent count; members flip to `sent`.

- [ ] **Step 4: Commit**

```bash
git add web/components/LaunchCampaignButton.tsx "web/app/(dashboard)/campaigns/[id]/page.tsx"
git commit -m "feat(campaign): launch control + channel-aware detail"
```

---

## Task 11: Cleanup — remove the dead bulk-send path

**Files:**
- Delete: `web/app/api/leads/send/route.ts`, `web/lib/outreach/route-send.ts`

- [ ] **Step 1: Confirm no remaining imports**

Run: `npm --prefix web run lint` and grep for usages:
`grep -rn "route-send\|/api/leads/send" web/` → expect **no** references after Task 8 (the LeadsTable no longer calls it).

- [ ] **Step 2: Delete the files**

```bash
git rm web/app/api/leads/send/route.ts web/lib/outreach/route-send.ts
```

- [ ] **Step 3: Verify type-check + lint**

Run: `npm --prefix web run typecheck && npm --prefix web run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(leads): remove dead best-channel bulk-send path"
```

---

## Self-Review

**Spec coverage:**
- "One way to send / Add to campaign replaces bulk-send" → Tasks 6, 8, 11. ✓
- "Pick leads (hand-pick + select all matching)" → Task 8 (select-all via Task 5 ids endpoint). ✓
- "Channel chosen at add-time; only eligible leads join; report skipped" → Tasks 1, 2, 6. ✓
- "Campaign create from selection + add to existing" → Tasks 3, 4. ✓
- "Email/SMS Launch within caps; voice/DM work-queue" → Tasks 9, 10. ✓
- "Suppressed/dup excluded" → Task 2. ✓
- Spine/nav retirement of `/calls`,`/replies`: they are **already absent from `lib/nav.ts`** (verified — nav has no calls/replies entries), so no nav task is needed; the voice work-queue lives in the campaign detail member list (Task 10). Flagged here so it isn't mistaken for a gap.

**Placeholder scan:** The only intentional "fill-in" is the `stage-6-sms` lead-type confirmation in Task 9 (called out explicitly with the `as never` forcing function). No TBD/TODO elsewhere.

**Type consistency:** `Channel` from `@/lib/campaigns/eligibility` used throughout; `addMembers(db, {id, channel}, leadIds)` signature matches its calls in Tasks 3 + 4; `AddResult.skipped` shape (`not_reachable`/`suppressed`/`already_member`) matches `AddMembersResult` in Task 2 and the dialog in Task 6; `isReachable`/`partitionForChannel` names consistent (Task 1).

**Scope:** Single subsystem (the send engine). Inbox/triage/dashboards are separate sub-projects per the spec.

---

## Open item for the implementer

Task 9 depends on the exact `stage-6-sms` export/lead shape — verify it before wiring (the plan flags it). If SMS sending isn't ready, ship email-only Launch (guard `camp.channel === "email"`) and treat SMS as a work-queue too for now.
