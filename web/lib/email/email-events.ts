/**
 * email/email-events.ts — read the email events the scoreboard counts, page by page (the database returns at most
 * 1,000 rows per read).
 *
 * Inputs:  a start time (ISO) or null for everything
 * Outputs: loadSends(since) → email_sent events · loadResponses(since) → reply / unsubscribe / complaint / bounce events
 * Used by: lib/email/email-results-load.ts, lib/email/email-tests.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import type { ResponseEvent, SendEvent } from "./email-results";

const PAGE = 1000;
const MAX_ROWS = 50_000;

async function pages<T>(kinds: string[], since: string | null, map: (r: { lead_id: string; kind: string; meta: unknown; created_at: string }) => T): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = getDb().from("outreach_events").select("lead_id,kind,meta,created_at").in("kind", kinds).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { lead_id: string; kind: string; meta: unknown; created_at: string }[];
    out.push(...rows.map(map));
    if (rows.length < PAGE) break;
  }
  return out;
}

export function loadSends(since: string | null): Promise<SendEvent[]> {
  return pages(["email_sent"], since, (r) => ({ lead_id: r.lead_id, at: r.created_at, meta: (r.meta as Record<string, unknown> | null) ?? null }));
}

export function loadResponses(since: string | null): Promise<ResponseEvent[]> {
  return pages(["email_reply", "email_unsubscribe", "email_complaint", "email_bounced"], since, (r) => ({
    lead_id: r.lead_id,
    at: r.created_at,
    kind: r.kind as ResponseEvent["kind"],
  }));
}
