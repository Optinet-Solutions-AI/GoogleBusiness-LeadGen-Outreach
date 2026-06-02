/**
 * api/leads/import/route.ts — POST: import leads from CSV text.
 *
 * Body: { csv_text, mapping: { business_name?, phone, city?, country_code?, website_url? } }
 * Parses CSV, maps columns, validates + normalizes phones, dedupes by phone within the
 * upload, inserts under one import batch. Returns { batch_id, imported, skipped, lead_ids }.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { parseCsv, mapCsvRow, validateLeadInput, buildLeadRow, dedupeKey } from "@/lib/leads/import";
import { ensureImportBatch } from "@/lib/campaigns/import-batch";

const Body = z.object({
  csv_text: z.string().min(1),
  mapping: z.object({
    business_name: z.string().optional(),
    phone: z.string(),
    city: z.string().optional(),
    country_code: z.string().optional(),
    website_url: z.string().optional(),
  }),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const rows = parseCsv(parsed.data.csv_text);
  if (rows.length === 0) return fail("No data rows in CSV", 400);

  const db = getDb();
  const batchId = await ensureImportBatch(db, "csv import");
  const seen = new Set<string>();
  const toInsert = [];
  let skipped = 0;
  for (const raw of rows) {
    const v = validateLeadInput(mapCsvRow(raw, parsed.data.mapping), "csv");
    if (!v.ok) { skipped++; continue; }
    const key = dedupeKey(v.lead);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    toInsert.push(buildLeadRow(v.lead, batchId));
  }
  if (toInsert.length === 0) return fail(`All ${rows.length} rows invalid/duplicate`, 400);

  const { data, error } = await db.from("leads").insert(toInsert).select("id");
  if (error) return fail(`insert failed: ${error.message}`, 502);
  return ok({ batch_id: batchId, imported: data.length, skipped, lead_ids: data.map((d) => d.id) });
});
