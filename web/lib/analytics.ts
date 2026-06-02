/**
 * analytics.ts — Voice + SMS campaign metrics (funnel, conversion, outcomes, monitoring, cost).
 *
 * Inputs:  Supabase rows — leads, call_attempts, outreach_events, batches (read-only)
 * Outputs: CampaignAnalytics — the numbers an operator needs to NOT run a campaign blind
 * Used by: app/(dashboard)/analytics/page.tsx, app/(dashboard)/batches/[id]/page.tsx,
 *          app/api/batches/[id]/metrics/route.ts
 *
 * Works on data we already capture in MANUAL mode (call_attempts + outreach_events from
 * migration 016), so it's useful today — before any live voice provider. The SMS / one-time-link
 * / form steps populate from outreach_events kinds the connected journey will emit
 * (sms_sent / form_link_opened / form_submitted); they read 0 until that ships, by design.
 * Actual per-call spend activates with the live provider (call_attempts.cost_usd + spend_ledger,
 * migration 018) — until then `cost.actual_usd` is null and we surface the estimate only.
 *
 * Aggregation is done in JS over a bounded fetch (free-tier volumes are small), mirroring the
 * "fetch-then-partition" pattern in app/(dashboard)/page.tsx — cheaper than many COUNT queries.
 */

import "server-only";
import { safeDb } from "./safe-db";
import { OFFERS, OFFER_LABEL, type Offer } from "./offers";

// ── Row shapes (only the columns we read) ────────────────────────────────
interface LeadRow {
  id: string;
  qualified: boolean | null;
  call_status: string | null;
  lifecycle_stage: string | null;
  primary_offer: string | null;
}
interface CallRow {
  lead_id: string;
  status: string;
  outcome: string | null;
  offer_pitched: string | null;
}
interface EventRow {
  lead_id: string | null;
  kind: string;
}

// ── Output shape ─────────────────────────────────────────────────────────
export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}
export interface OfferRow {
  offer: Offer;
  label: string;
  called: number;
  interested: number;
  finished: number;
}
export interface CampaignAnalytics {
  /** Ordered funnel: leads → called → connected → interested → texted → clicked → finished. */
  funnel: FunnelStep[];
  /** Key conversion rates (0–100, one decimal), null when the denominator is 0. */
  rates: {
    contact: number | null; // called → connected
    interest: number | null; // connected → interested
    link_click: number | null; // texted → clicked
    form: number | null; // clicked → finished
    overall: number | null; // leads → finished
  };
  /** call_attempts grouped by status and by disposition outcome. */
  outcomes: {
    by_status: Record<string, number>;
    by_outcome: Record<string, number>;
    total_attempts: number;
  };
  /** Operational health — what needs attention right now. */
  monitoring: {
    open: number; // queued + dialing (in-flight)
    failed: number;
    no_answer: number;
    voicemail: number;
    suppressed: number; // leads on DNC / opted-out — excluded from future dials
  };
  /** Money. actual_* are null until the live provider reports per-call cost. */
  cost: {
    estimated_usd: number;
    actual_usd: number | null;
    cost_per_finished_usd: number | null;
  };
  by_offer: OfferRow[];
  /** True when no call has happened yet — the dashboard shows a "ready, not blind" empty state. */
  is_empty: boolean;
}

const CONNECTED_STATUSES = new Set(["connected", "completed"]);
const SUPPRESSED_LIFECYCLE = new Set(["dnc", "unsubscribed"]);

/** distinct lead_ids among events whose kind is one of `kinds`. */
function leadsWithKind(events: EventRow[], kinds: string[]): Set<string> {
  const want = new Set(kinds);
  const out = new Set<string>();
  for (const e of events) if (e.lead_id && want.has(e.kind)) out.add(e.lead_id);
  return out;
}

function rate(numer: number, denom: number): number | null {
  if (denom <= 0) return null;
  return +((numer / denom) * 100).toFixed(1);
}

/**
 * Pure metric computation — no I/O, so it unit-tests cleanly. `calls` and `events` must already be
 * scoped to the leads in `leads` (the loader filters by the scope's lead-id set).
 */
export function computeAnalytics(
  leads: LeadRow[],
  calls: CallRow[],
  events: EventRow[],
  estimatedUsd: number,
): CampaignAnalytics {
  const qualified = leads.filter((l) => l.qualified !== false);
  const leadCount = qualified.length;

  const calledSet = new Set(calls.map((c) => c.lead_id));
  const connectedSet = new Set(
    calls.filter((c) => CONNECTED_STATUSES.has(c.status) || c.outcome).map((c) => c.lead_id),
  );
  const interestedSet = new Set(
    calls.filter((c) => c.outcome === "interested").map((c) => c.lead_id),
  );
  const textedSet = leadsWithKind(events, ["sms_sent"]);
  const clickedSet = leadsWithKind(events, ["form_link_opened"]);
  const finishedSet = leadsWithKind(events, ["form_submitted"]);

  const funnel: FunnelStep[] = [
    { key: "leads", label: "Leads", count: leadCount },
    { key: "called", label: "Called", count: calledSet.size },
    { key: "connected", label: "Connected", count: connectedSet.size },
    { key: "interested", label: "Interested", count: interestedSet.size },
    { key: "texted", label: "Texted", count: textedSet.size },
    { key: "clicked", label: "Clicked", count: clickedSet.size },
    { key: "finished", label: "Finished", count: finishedSet.size },
  ];

  // Outcome / status breakdown.
  const byStatus: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  for (const c of calls) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    if (c.outcome) byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
  }

  // Monitoring — from the live status fields on the call_attempts + leads.
  const open = calls.filter((c) => c.status === "queued" || c.status === "dialing").length;
  const failed = calls.filter((c) => c.status === "failed").length;
  const noAnswer = calls.filter((c) => c.status === "no_answer").length;
  const voicemail = calls.filter((c) => c.status === "voicemail").length;
  const suppressed = qualified.filter(
    (l) => SUPPRESSED_LIFECYCLE.has(l.lifecycle_stage ?? "") || l.call_status === "dnc",
  ).length;

  // By offer — which pitch actually converts.
  const byOffer: OfferRow[] = OFFERS.map((offer) => {
    const offerCalls = calls.filter((c) => c.offer_pitched === offer);
    const calledIds = new Set(offerCalls.map((c) => c.lead_id));
    const interestedIds = new Set(
      offerCalls.filter((c) => c.outcome === "interested").map((c) => c.lead_id),
    );
    // "finished" isn't offer-tagged on the event, so attribute via the lead's primary_offer.
    const finishedForOffer = qualified.filter(
      (l) => l.primary_offer === offer && finishedSet.has(l.id),
    ).length;
    return {
      offer,
      label: OFFER_LABEL[offer],
      called: calledIds.size,
      interested: interestedIds.size,
      finished: finishedForOffer,
    };
  });

  return {
    funnel,
    rates: {
      contact: rate(connectedSet.size, calledSet.size),
      interest: rate(interestedSet.size, connectedSet.size),
      link_click: rate(clickedSet.size, textedSet.size),
      form: rate(finishedSet.size, clickedSet.size),
      overall: rate(finishedSet.size, leadCount),
    },
    outcomes: { by_status: byStatus, by_outcome: byOutcome, total_attempts: calls.length },
    monitoring: { open, failed, no_answer: noAnswer, voicemail, suppressed },
    cost: {
      estimated_usd: +estimatedUsd.toFixed(2),
      actual_usd: null,
      cost_per_finished_usd: null,
    },
    by_offer: byOffer,
    is_empty: calls.length === 0 && textedSet.size === 0,
  };
}

/**
 * Load + compute analytics for one batch (campaign) or, when `batchId` is omitted, all-time.
 * Resilient: a DB hiccup or a not-yet-applied table yields an empty (zeroed) result rather than
 * throwing, so the dashboard always renders.
 */
export async function loadAnalytics(batchId?: string): Promise<CampaignAnalytics> {
  const empty = computeAnalytics([], [], [], 0);

  return safeDb<CampaignAnalytics>(async (db) => {
    // 1. Leads in scope (qualified only — the funnel base).
    let leadQ = db
      .from("leads")
      .select("id,qualified,call_status,lifecycle_stage,primary_offer")
      .neq("qualified", false)
      .limit(20000);
    if (batchId) leadQ = leadQ.eq("batch_id", batchId);
    const { data: leadsData } = await leadQ;
    const leads = (leadsData ?? []) as LeadRow[];
    const scope = new Set(leads.map((l) => l.id));

    // 2. Calls + journey events, filtered to the scope client-side (avoids a huge `.in(...)`).
    const [{ data: callsData }, { data: eventsData }] = await Promise.all([
      db.from("call_attempts").select("lead_id,status,outcome,offer_pitched").limit(50000),
      db.from("outreach_events").select("lead_id,kind").limit(50000),
    ]);
    const calls = ((callsData ?? []) as CallRow[]).filter((c) => scope.has(c.lead_id));
    const events = ((eventsData ?? []) as EventRow[]).filter((e) => e.lead_id && scope.has(e.lead_id));

    // 3. Estimated cost (the only cost signal until the live provider reports actuals).
    let batchQ = db.from("batches").select("estimated_cost_usd");
    if (batchId) batchQ = batchQ.eq("id", batchId);
    const { data: batchData } = await batchQ;
    const estimated = (batchData ?? []).reduce(
      (sum: number, b: { estimated_cost_usd: number | null }) => sum + (b.estimated_cost_usd ?? 0),
      0,
    );

    return computeAnalytics(leads, calls, events, estimated);
  }, empty);
}

/**
 * Campaign-scoped analytics: same shape as loadAnalytics, but scoped to a campaign's
 * snapshot membership (campaign_leads) instead of a batch. Reuses computeAnalytics.
 */
export async function loadCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  const empty = computeAnalytics([], [], [], 0);
  return safeDb<CampaignAnalytics>(async (db) => {
    const { data: members } = await db
      .from("campaign_leads")
      .select("lead_id")
      .eq("campaign_id", campaignId)
      .limit(20000);
    const ids = new Set((members ?? []).map((m: { lead_id: string }) => m.lead_id));
    if (ids.size === 0) return empty;

    const { data: leadRows } = await db
      .from("leads")
      .select("id,qualified,call_status,lifecycle_stage,primary_offer")
      .neq("qualified", false)
      .limit(20000);
    const leads = ((leadRows ?? []) as LeadRow[]).filter((l) => ids.has(l.id));

    const [{ data: callsData }, { data: eventsData }] = await Promise.all([
      db.from("call_attempts").select("lead_id,status,outcome,offer_pitched").limit(50000),
      db.from("outreach_events").select("lead_id,kind").limit(50000),
    ]);
    const calls = ((callsData ?? []) as CallRow[]).filter((c) => ids.has(c.lead_id));
    const events = ((eventsData ?? []) as EventRow[]).filter((e) => e.lead_id && ids.has(e.lead_id));
    return computeAnalytics(leads, calls, events, 0);
  }, empty);
}
