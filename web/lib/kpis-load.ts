/**
 * kpis-load.ts — server loader for the KPI band: one parallel fetch, then the
 * pure computeKpis() does the math.
 *
 * Inputs:  a KpiRange
 * Outputs: Kpis (zeroed on any DB hiccup, so the band always renders)
 * Used by: app/(dashboard)/analytics/page.tsx
 *
 * Split from kpis.ts so the pure compute stays unit-testable without importing
 * server-only / the DB client.
 */

import "server-only";
import { safeDb } from "./safe-db";
import {
  computeKpis,
  type Kpis,
  type KpiRange,
  type KpiLead,
  type KpiEvent,
  type KpiCall,
} from "./kpis";

export async function loadKpis(range: KpiRange): Promise<Kpis> {
  const now = new Date();
  const empty = computeKpis([], [], [], range, now);

  return safeDb<Kpis>(async (db) => {
    const [leadRes, eventRes, callRes] = await Promise.all([
      db
        .from("leads")
        .select("qualified,email,phone,stage,created_at,updated_at")
        .neq("qualified", false)
        .limit(20000),
      db.from("outreach_events").select("kind,created_at").limit(50000),
      db.from("call_attempts").select("status,created_at").limit(50000),
    ]);
    return computeKpis(
      (leadRes.data ?? []) as KpiLead[],
      (eventRes.data ?? []) as KpiEvent[],
      (callRes.data ?? []) as KpiCall[],
      range,
      now,
    );
  }, empty);
}
