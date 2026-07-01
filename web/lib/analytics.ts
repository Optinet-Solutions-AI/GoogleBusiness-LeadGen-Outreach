/**
 * analytics.ts — SMS campaign metrics (funnel, conversion, monitoring, cost).
 *
 * Inputs:  Supabase rows — leads, outreach_events, batches (read-only)
 * Outputs: CampaignAnalytics — the numbers an operator needs to NOT run a campaign blind
 * Used by: app/(dashboard)/analytics/page.tsx, app/(dashboard)/batches/[id]/page.tsx,
 *          app/api/batches/[id]/metrics/route.ts
 *
 * Aggregation is done in JS over a bounded fetch (free-tier volumes are small), mirroring the
 * "fetch-then-partition" pattern in app/(dashboard)/page.tsx — cheaper than many COUNT queries.
 */

import "@/lib/server-guard";
import { safeDb } from "./safe-db";
import { OFFERS, OFFER_LABEL, type Offer } from "./offers";

// ── Row shapes (only the columns we read) ────────────────────────────────
interface LeadRow {
  id: string;
  qualified: boolean | null;
  lifecycle_stage: string | null;
  primary_offer: string | null;
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
  finished: number;
}
export interface CampaignAnalytics {
  /** Ordered funnel: leads → texted → clicked → finished. */
  funnel: FunnelStep[];
  /** Key conversion rates (0–100, one decimal), null when the denominator is 0. */
  rates: {
    link_click: number | null; // texted → clicked
    form: number | null; // clicked → finished
    overall: number | null; // leads → finished
  };
  /** Operational health — what needs attention right now. */
  monitoring: {
    suppressed: number; // leads on DNC / opted-out — excluded from future sends
  };
  /** Money. actual_* are null until the live provider reports per-send cost. */
  cost: {
    estimated_usd: number;
    actual_usd: number | null;
    cost_per_finished_usd: number | null;
  };
  by_offer: OfferRow[];
  /** True when no SMS has been sent yet — the dashboard shows a "ready, not blind" empty state. */
  is_empty: boolean;
}

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
 * Pure metric computation — no I/O, so it unit-tests cleanly. `events` must already be
 * scoped to the leads in `leads` (the loader filters by the scope's lead-id set).
 */
export function computeAnalytics(
  leads: LeadRow[],
  events: EventRow[],
  estimatedUsd: number,
): CampaignAnalytics {
  const qualified = leads.filter((l) => l.qualified !== false);
  const leadCount = qualified.length;

  const textedSet = leadsWithKind(events, ["sms_sent"]);
  const clickedSet = leadsWithKind(events, ["form_link_opened"]);
  const finishedSet = leadsWithKind(events, ["form_submitted"]);

  const funnel: FunnelStep[] = [
    { key: "leads", label: "Leads", count: leadCount },
    { key: "texted", label: "Texted", count: textedSet.size },
    { key: "clicked", label: "Clicked", count: clickedSet.size },
    { key: "finished", label: "Finished", count: finishedSet.size },
  ];

  // Monitoring — from lifecycle_stage on leads.
  const suppressed = qualified.filter(
    (l) => SUPPRESSED_LIFECYCLE.has(l.lifecycle_stage ?? ""),
  ).length;

  // By offer — which pitch actually converts.
  const byOffer: OfferRow[] = OFFERS.map((offer) => {
    // "finished" isn't offer-tagged on the event, so attribute via the lead's primary_offer.
    const finishedForOffer = qualified.filter(
      (l) => l.primary_offer === offer && finishedSet.has(l.id),
    ).length;
    return {
      offer,
      label: OFFER_LABEL[offer],
      finished: finishedForOffer,
    };
  });

  return {
    funnel,
    rates: {
      link_click: rate(clickedSet.size, textedSet.size),
      form: rate(finishedSet.size, clickedSet.size),
      overall: rate(finishedSet.size, leadCount),
    },
    monitoring: { suppressed },
    cost: {
      estimated_usd: +estimatedUsd.toFixed(2),
      actual_usd: null,
      cost_per_finished_usd: null,
    },
    by_offer: byOffer,
    is_empty: textedSet.size === 0,
  };
}

/**
 * Load + compute analytics for one batch (campaign) or, when `batchId` is omitted, all-time.
 * Resilient: a DB hiccup or a not-yet-applied table yields an empty (zeroed) result rather than
 * throwing, so the dashboard always renders.
 */
export async function loadAnalytics(batchId?: string): Promise<CampaignAnalytics> {
  const empty = computeAnalytics([], [], 0);

  return safeDb<CampaignAnalytics>(async (db) => {
    // All reads are independent (events are scoped in JS, not via a query join),
    // so fire them in one Promise.all — a single round-trip instead of serial ones
    // (matters a lot on a high-latency free-tier DB).
    const leadQ = db
      .from("leads")
      .select("id,qualified,lifecycle_stage,primary_offer")
      .neq("qualified", false)
      .limit(20000);
    const scopedLeadQ = batchId ? leadQ.eq("batch_id", batchId) : leadQ;
    const batchQ = batchId
      ? db.from("batches").select("estimated_cost_usd").eq("id", batchId)
      : db.from("batches").select("estimated_cost_usd");

    const [leadRes, eventsRes, batchRes] = await Promise.all([
      scopedLeadQ,
      db.from("outreach_events").select("lead_id,kind").limit(50000),
      batchQ,
    ]);

    const leads = (leadRes.data ?? []) as LeadRow[];
    const scope = new Set(leads.map((l) => l.id));
    const events = ((eventsRes.data ?? []) as EventRow[]).filter((e) => e.lead_id && scope.has(e.lead_id));
    const estimated = ((batchRes.data ?? []) as { estimated_cost_usd: number | null }[]).reduce(
      (sum, b) => sum + (b.estimated_cost_usd ?? 0),
      0,
    );

    return computeAnalytics(leads, events, estimated);
  }, empty);
}

/**
 * Campaign-scoped analytics: same shape as loadAnalytics, but scoped to a campaign's
 * snapshot membership (campaign_leads) instead of a batch. Reuses computeAnalytics.
 */
export async function loadCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  const empty = computeAnalytics([], [], 0);
  return safeDb<CampaignAnalytics>(async (db) => {
    // One parallel round-trip; membership ids scope the others in JS.
    const [membersRes, leadRes, eventsRes] = await Promise.all([
      db.from("campaign_leads").select("lead_id").eq("campaign_id", campaignId).limit(20000),
      db.from("leads").select("id,qualified,lifecycle_stage,primary_offer").neq("qualified", false).limit(20000),
      db.from("outreach_events").select("lead_id,kind").limit(50000),
    ]);
    const ids = new Set(((membersRes.data ?? []) as { lead_id: string }[]).map((m) => m.lead_id));
    if (ids.size === 0) return empty;
    const leads = ((leadRes.data ?? []) as LeadRow[]).filter((l) => ids.has(l.id));
    const events = ((eventsRes.data ?? []) as EventRow[]).filter((e) => e.lead_id && ids.has(e.lead_id));
    return computeAnalytics(leads, events, 0);
  }, empty);
}
