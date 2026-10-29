/**
 * lead-signal-data.ts — fetch signal columns separately from the main lead select.
 *
 * Inputs:  lead ids
 * Outputs: Map<id, SignalFields> (empty if migration 049 is not applied yet)
 * Used by: app/(dashboard)/batches/[id]/page.tsx, app/(dashboard)/leads/page.tsx, leads/[id]/page.tsx
 *
 * Kept as its own query so a DB without the 049 columns degrades to "no signal"
 * instead of breaking the existing pages' selects.
 */

import "@/lib/server-guard";
import { getDb } from "./db";
import { SIGNAL_FIELD_COLS, type SignalFields } from "./lead-signal";

export async function fetchSignals(
  scope: { batchId: string } | { ids: string[] },
): Promise<Map<string, SignalFields>> {
  const out = new Map<string, SignalFields>();
  try {
    let q = getDb().from("leads").select(`id,${SIGNAL_FIELD_COLS}`).not("signal_type", "is", null);
    if ("batchId" in scope) q = q.eq("batch_id", scope.batchId);
    else if (scope.ids.length) q = q.in("id", scope.ids);
    else return out;
    const { data, error } = await q;
    if (error || !data) return out;
    for (const r of data as unknown as Array<SignalFields & { id: string }>) out.set(r.id, r);
  } catch {
    /* columns missing / DB unavailable — no signals */
  }
  return out;
}
