/**
 * lead-score-load.ts — load the lead score for the leads on a list, in its own query (27 Nov 2026).
 *
 * Inputs:  a batch id or lead ids
 * Outputs: Map<lead id, ScoreSummary> (score, band, reasons, holding back) — empty without migration 076
 * Used by: app/(dashboard)/leads/page.tsx, app/(dashboard)/batches/[id]/page.tsx (the Score column),
 *          lib/brain/plan.ts (the Brain's facts + plan order), lib/campaigns/batch-email-plan.ts (who goes first)
 *
 * Separate from the lists' main select (like lib/leads/website-verdicts.ts) so a database without 076 still renders.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { bandOf, type ScoreSummary } from "./lead-score";

type Row = { id: string; lead_score: number | null; lead_score_detail: { reasons?: unknown; holding_back?: unknown } | null };

export async function fetchLeadScores(scope: { batchId: string } | { ids: string[] }): Promise<Map<string, ScoreSummary>> {
  const out = new Map<string, ScoreSummary>();
  try {
    const rows: Row[] = [];
    if ("batchId" in scope) {
      for (let from = 0; from < 5000; from += 1000) {
        const { data, error } = await getDb()
          .from("leads")
          .select("id,lead_score,lead_score_detail")
          .eq("batch_id", scope.batchId)
          .not("lead_score", "is", null)
          .order("id")
          .range(from, from + 999);
        if (error || !data) return out;
        rows.push(...(data as unknown as Row[]));
        if (data.length < 1000) break;
      }
    } else {
      if (!scope.ids.length) return out;
      for (let i = 0; i < scope.ids.length; i += 150) {
        const { data, error } = await getDb()
          .from("leads")
          .select("id,lead_score,lead_score_detail")
          .in("id", scope.ids.slice(i, i + 150))
          .not("lead_score", "is", null);
        if (error || !data) return out;
        rows.push(...(data as unknown as Row[]));
      }
    }
    for (const r of rows) {
      if (typeof r.lead_score !== "number") continue;
      const d = r.lead_score_detail ?? {};
      out.set(r.id, {
        score: r.lead_score,
        band: bandOf(r.lead_score),
        reasons: Array.isArray(d.reasons) ? d.reasons.filter((x): x is string => typeof x === "string") : [],
        holding_back: typeof d.holding_back === "string" ? d.holding_back : "",
      });
    }
  } catch {
    /* column missing / DB unavailable — lists show "—" */
  }
  return out;
}
