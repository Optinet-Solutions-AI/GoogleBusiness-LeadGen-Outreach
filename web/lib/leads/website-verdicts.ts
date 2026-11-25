/**
 * website-verdicts.ts — load the AI website check's verdict for the leads on a list, in its own query.
 *
 * Inputs:  a batch id or lead ids
 * Outputs: Map<lead id, VerdictSummary> (verdict, score, summary, pitch why) — empty without migration 069
 * Used by: app/(dashboard)/leads/page.tsx, app/(dashboard)/batches/[id]/page.tsx (the website badge, LeadBadges)
 *
 * Separate from the lists' main select (like lib/lead-signal-data.ts) so a database without 069 still renders,
 * and only the four small fields are read, not the whole review.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import type { SiteVerdict, VerdictSummary } from "./website-review";

const COLS = "id,verdict:website_review->>verdict,score:website_review->>score,summary:website_review->>summary,pitch_why:website_review->pitch->>why";
const VERDICTS: readonly string[] = ["no_website", "old_website", "good_website"];

export async function fetchWebsiteVerdicts(scope: { batchId: string } | { ids: string[] }): Promise<Map<string, VerdictSummary>> {
  const out = new Map<string, VerdictSummary>();
  try {
    let q = getDb().from("leads").select(COLS).not("website_review", "is", null);
    if ("batchId" in scope) q = q.eq("batch_id", scope.batchId);
    else if (scope.ids.length) q = q.in("id", scope.ids);
    else return out;
    const { data, error } = await q;
    if (error || !data) return out;
    for (const r of data as unknown as Array<{ id: string; verdict: string | null; score: string | null; summary: string | null; pitch_why: string | null }>) {
      if (!r.verdict || !VERDICTS.includes(r.verdict)) continue; // a re-check still running on a never-checked lead
      out.set(r.id, { verdict: r.verdict as SiteVerdict, score: r.score, summary: r.summary, pitch_why: r.pitch_why });
    }
  } catch {
    /* column missing / DB unavailable — lists show the older badge */
  }
  return out;
}
