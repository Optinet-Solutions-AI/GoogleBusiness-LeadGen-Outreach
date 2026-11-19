/**
 * pipeline/refound.ts — split review-site rows into new leads and profiles already on a lead from an earlier batch
 * (19 Nov 2026). Pure.
 *
 * Inputs:  stage-1 rows (each with place_id = "<platform>:<profile path>"), a map place_id → id of the existing lead
 *          in another batch
 * Outputs: { insert: rows to save as new leads, refresh: [{ id, patch: rating / review_count / signal_meta }] } — a
 *          re-found business never becomes a second lead and never has its stage, contacts or offer changed
 * Used by: lib/pipeline/stage-1-scrape.ts (trustpilot / tripadvisor batches)
 */

export function splitRefound(
  rows: Record<string, unknown>[],
  existing: Map<string, string>,
): { insert: Record<string, unknown>[]; refresh: { id: string; patch: { rating: unknown; review_count: unknown; signal_meta: unknown } }[] } {
  const insert: Record<string, unknown>[] = [];
  const refresh: { id: string; patch: { rating: unknown; review_count: unknown; signal_meta: unknown } }[] = [];
  for (const row of rows) {
    const id = typeof row.place_id === "string" ? existing.get(row.place_id) : undefined;
    if (id) refresh.push({ id, patch: { rating: row.rating, review_count: row.review_count, signal_meta: row.signal_meta } });
    else insert.push(row);
  }
  return { insert, refresh };
}
