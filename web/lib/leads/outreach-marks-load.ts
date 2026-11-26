/**
 * leads/outreach-marks-load.ts — load what we already sent the leads on a list, in its own two queries.
 *
 * Inputs:  lead ids (one page of the Leads list)
 * Outputs: Map<lead id, OutreachMark> — empty on any error (the list still renders, just without the marks)
 * Used by: app/(dashboard)/leads/page.tsx
 *
 * Separate from the list's main select (like lib/leads/website-verdicts.ts): a database without contact_form_runs
 * (migration 065) still shows the email marks.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { buildOutreachMarks, type MarkRun, type OutreachMark } from "./outreach-marks";

export async function fetchOutreachMarks(ids: string[]): Promise<Map<string, OutreachMark>> {
  if (!ids.length) return new Map();
  try {
    const db = getDb();
    const [emails, runs] = await Promise.all([
      db.from("outreach_events").select("lead_id,created_at").eq("kind", "email_sent").in("lead_id", ids).order("created_at", { ascending: false }).limit(2000),
      db.from("contact_form_runs").select("lead_id,status,created_at,updated_at,sent_at,message").in("lead_id", ids).order("created_at", { ascending: false }).limit(1000),
    ]);
    return buildOutreachMarks(
      (emails.error ? [] : (emails.data ?? [])) as { lead_id: string; created_at: string }[],
      (runs.error ? [] : (runs.data ?? [])) as MarkRun[],
    );
  } catch {
    return new Map();
  }
}
