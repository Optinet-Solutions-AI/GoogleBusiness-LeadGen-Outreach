/**
 * analytics/cost-per-reply-load.ts — read what the "Cost per reply" section needs (27 Nov 2026). Read-only, free.
 *
 * Inputs:  the grouping (niche / city / offer) and the range (30 / 90 days / all, by batch creation date)
 * Outputs: CprRow[] (lib/analytics/cost-per-reply.ts)
 * Used by: app/(dashboard)/analytics/page.tsx
 *
 * Reads batches, their leads, the leads' outreach events (sends, forms, calls, replies, interested calls),
 * contact_form_runs.usd and Test mode's on / off history. Paged and chunked; volumes are small on the free tier.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { getTestMode } from "@/lib/test-mode";
import { testPeriods } from "@/lib/test-mode-rules";
import { resolveSegment, type SegmentLead } from "@/lib/segment";
import { defaultService, SERVICES } from "@/lib/email/service-templates";
import { costPerReply, type CprBatch, type CprEvent, type CprLead, type CprRow, type GroupBy } from "./cost-per-reply";

const log = getLogger("cost-per-reply");
const KINDS = ["email_sent", "contact_form_sent", "call_placed", "email_reply", "call_qualified"];

async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

const chunks = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const offerLabel = (l: SegmentLead) => {
  const key = defaultService(resolveSegment(l));
  return SERVICES.find((s) => s.key === key)?.label ?? key;
};

export async function loadCostPerReply(groupBy: GroupBy, days: 30 | 90 | null): Promise<CprRow[]> {
  const db = getDb();
  const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  try {
    const batches = await paged<CprBatch>((from, to) => {
      let q = db.from("batches").select("id,niche,city,created_at,estimated_cost_usd").order("created_at", { ascending: true });
      if (since) q = q.gte("created_at", since);
      return q.range(from, to);
    });
    if (!batches.length) return [];

    type LeadRow = SegmentLead & { id: string; batch_id: string; category: string | null };
    const leadRows: LeadRow[] = [];
    for (const ids of chunks(batches.map((b) => b.id), 100)) {
      leadRows.push(
        ...(await paged<LeadRow>((from, to) =>
          db.from("leads").select("id,batch_id,category,call_segment,website_kind,has_website,needs_improvement,signal_type").in("batch_id", ids).order("id").range(from, to),
        )),
      );
    }
    const leads: CprLead[] = leadRows.map((l) => ({ id: l.id, batch_id: l.batch_id, category: l.category, offer: offerLabel(l) }));

    const events: CprEvent[] = [];
    const formUsd = new Map<string, number>();
    for (const ids of chunks(leads.map((l) => l.id), 200)) {
      const ev = await paged<{ lead_id: string; kind: string; created_at: string; noop: string | null }>((from, to) =>
        db.from("outreach_events").select("lead_id,kind,created_at,noop:meta->>noop").in("lead_id", ids).in("kind", KINDS).order("id").range(from, to),
      );
      for (const e of ev) events.push({ lead_id: e.lead_id, kind: e.kind, at: e.created_at, noop: e.noop === "true" });
      // Contact form costs (migration 065; none without it).
      const { data: runs, error } = await db.from("contact_form_runs").select("lead_id,usd").in("lead_id", ids).not("usd", "is", null);
      if (!error) for (const r of (runs ?? []) as { lead_id: string; usd: number | string }[]) formUsd.set(r.lead_id, (formUsd.get(r.lead_id) ?? 0) + (Number(r.usd) || 0));
    }

    const periods = testPeriods(await getTestMode(), new Date());
    return costPerReply({ batches, leads, events, formUsd, groupBy, since, periods });
  } catch (err) {
    log.warn({ err: String(err).slice(0, 200) }, "cost_per_reply.load_failed");
    return [];
  }
}
