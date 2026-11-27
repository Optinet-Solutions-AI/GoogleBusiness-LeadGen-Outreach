/**
 * analytics/cost-per-reply.ts — what a reply cost, per niche, city or offer (27 Nov 2026). Pure.
 *
 * Inputs:  batches (niche, city, created_at, estimated_cost_usd), their leads (category, offer label), the leads'
 *          outreach events, contact form costs per lead, the grouping, the date limit, Test mode's on-periods
 * Outputs: CprRow[] — found / contacted / emails / replies / reply rate / interested calls / spend / cost per reply,
 *          most spend first
 * Used by: lib/analytics/cost-per-reply-load.ts (the /analytics "Cost per reply" section)
 *
 * Rules (spec docs/superpowers/specs/2026-11-27-lead-score-and-cost-per-reply-design.md, Part 2):
 * - spend per lead = the batch's estimate shared evenly over ALL its leads + that lead's contact form costs;
 * - the date limit filters by when the batch was created (so leads never reached still count as cost);
 * - contacted = at least one email that really went out, contact form sent or AI call placed;
 * - reply = a human email reply, once per lead; interested call = a call_qualified, once per lead;
 * - anything that happened while Test mode was on is left out (it reached a test contact, not the business).
 */
import { inTestPeriod } from "@/lib/test-mode-rules";

export type GroupBy = "niche" | "city" | "offer";

export interface CprBatch {
  id: string;
  niche: string;
  city: string;
  created_at: string;
  estimated_cost_usd: number | null;
}

export interface CprLead {
  id: string;
  batch_id: string;
  category: string | null;
  /** The offer we'd pitch, as a label ("Build a website"). */
  offer: string;
}

export interface CprEvent {
  lead_id: string;
  kind: string;
  at: string;
  /** An email that didn't really go out (no mailbox). */
  noop?: boolean;
}

export interface CprRow {
  key: string;
  found: number;
  contacted: number;
  emails: number;
  replies: number;
  /** replies / contacted (0–1); null when nobody was contacted. */
  rate: number | null;
  interested_calls: number;
  spend: number;
  /** spend / replies; null with no replies. */
  cost_per_reply: number | null;
}

const CONTACT_KINDS = new Set(["email_sent", "contact_form_sent", "call_placed"]);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function groupKey(groupBy: GroupBy, b: CprBatch, l: CprLead): string {
  if (groupBy === "city") return b.city || "Unknown";
  if (groupBy === "offer") return l.offer || "Unknown";
  // "Any <category>" batches mix niches: use the lead's own category.
  if (/^any\b/i.test(b.niche.trim())) return l.category?.trim() || "Unknown";
  return b.niche || "Unknown";
}

/** Each lead's contact form costs, leaving out runs made while Test mode was on (they reached a test page). */
export function formSpend(runs: { lead_id: string; usd: number | string | null; at: string }[], periods: { from: string; to: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of runs) {
    if (inTestPeriod(r.at, periods)) continue;
    const usd = Number(r.usd) || 0;
    if (usd) out.set(r.lead_id, round6((out.get(r.lead_id) ?? 0) + usd));
  }
  return out;
}

export function costPerReply(o: {
  batches: CprBatch[];
  leads: CprLead[];
  events: CprEvent[];
  formUsd: Map<string, number>;
  groupBy: GroupBy;
  since: string | null;
  periods: { from: string; to: string }[];
}): CprRow[] {
  const since = o.since ? Date.parse(o.since) : null;
  const batches = new Map(o.batches.filter((b) => since === null || Date.parse(b.created_at) >= since).map((b) => [b.id, b]));
  const leads = o.leads.filter((l) => batches.has(l.batch_id));
  const perBatch = new Map<string, number>();
  for (const l of leads) perBatch.set(l.batch_id, (perBatch.get(l.batch_id) ?? 0) + 1);

  // What happened to each lead (outside Test mode).
  type Seen = { contacted: boolean; emails: number; replied: boolean; interested: boolean };
  const seen = new Map<string, Seen>();
  for (const e of o.events) {
    if (e.noop || inTestPeriod(e.at, o.periods)) continue;
    const s = seen.get(e.lead_id) ?? { contacted: false, emails: 0, replied: false, interested: false };
    if (CONTACT_KINDS.has(e.kind)) s.contacted = true;
    if (e.kind === "email_sent") s.emails++;
    if (e.kind === "email_reply") s.replied = true;
    if (e.kind === "call_qualified") s.interested = true;
    seen.set(e.lead_id, s);
  }

  const rows = new Map<string, CprRow>();
  for (const l of leads) {
    const b = batches.get(l.batch_id)!;
    const key = groupKey(o.groupBy, b, l);
    const r = rows.get(key) ?? { key, found: 0, contacted: 0, emails: 0, replies: 0, rate: null, interested_calls: 0, spend: 0, cost_per_reply: null };
    const s = seen.get(l.id);
    r.found++;
    if (s?.contacted) r.contacted++;
    r.emails += s?.emails ?? 0;
    if (s?.replied) r.replies++;
    if (s?.interested) r.interested_calls++;
    r.spend += (Number(b.estimated_cost_usd) || 0) / (perBatch.get(l.batch_id) ?? 1) + (o.formUsd.get(l.id) ?? 0);
    rows.set(key, r);
  }

  return [...rows.values()]
    .map((r) => {
      const spend = round6(r.spend);
      return { ...r, spend, rate: r.contacted ? r.replies / r.contacted : null, cost_per_reply: r.replies ? round6(spend / r.replies) : null };
    })
    .sort((a, b) => b.spend - a.spend || a.key.localeCompare(b.key));
}
