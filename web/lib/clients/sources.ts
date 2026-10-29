/**
 * sources.ts — client source rows (where Brand Brain facts come from) + operator intake form.
 *
 * Inputs:  client id, source kind/url, IntakeForm
 * Outputs: client_sources rows; pure autoSourcesForLead mapping
 * Used by: lib/clients/clients.ts, /api/clients/[id]/sources, /api/clients/[id]/intake
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";
import type { SourceKind } from "./types";

export const IntakeForm = z.object({
  sells: z.string(),
  customers: z.string(),
  tone: z.array(z.string()),
  tone_note: z.string(),
  always_mention: z.string(),
  never_claim: z.string(),
  cta_kind: z.enum(["call", "book", "message", "visit", "website"]),
  cta_target: z.string(),
  other: z.string(),
});
export type IntakeForm = z.infer<typeof IntakeForm>;

export type SourceRow = {
  id: string;
  client_id: string;
  kind: SourceKind;
  url: string | null;
  status: "new" | "crawled" | "partial" | "blocked" | "failed";
  last_crawled_at: string | null;
  last_error: string | null;
  page_count: number | null;
  intake: IntakeForm | null;
  created_at: string;
  updated_at: string;
};

/** Pure: which sources a lead implies for its client. */
export function autoSourcesForLead(lead: {
  demo_url: string | null;
  website_url: string | null;
  website_kind: string | null;
}): { kind: SourceKind; url: string | null }[] {
  const out: { kind: SourceKind; url: string | null }[] = [{ kind: "google_maps", url: null }];
  if (lead.demo_url) out.push({ kind: "demo_site", url: lead.demo_url });
  if (lead.website_kind === "real" && lead.website_url) {
    out.push({ kind: "website", url: lead.website_url });
  } else if (lead.website_kind === "facebook" || lead.website_kind === "instagram") {
    out.push({ kind: lead.website_kind, url: lead.website_url });
  }
  return out;
}

/** Select-then-insert (the unique index is an expression index, so upsert cannot target it). */
export async function attachSource(
  clientId: string,
  input: { kind: SourceKind; url?: string | null },
): Promise<SourceRow> {
  const db = getDb();
  const url = input.url ?? null;
  let q = db.from("client_sources").select("*").eq("client_id", clientId).eq("kind", input.kind);
  q = url === null ? q.is("url", null) : q.eq("url", url);
  const { data: existing, error: selErr } = await q.maybeSingle();
  if (selErr) throw new Error(`source lookup failed: ${selErr.message}`);
  if (existing) return existing as SourceRow;
  const { data, error } = await db
    .from("client_sources")
    .insert({ client_id: clientId, kind: input.kind, url })
    .select("*")
    .single();
  if (error || !data) throw new Error(`source insert failed: ${error?.message}`);
  return data as SourceRow;
}

export async function removeSource(clientId: string, sourceId: string): Promise<void> {
  const { error } = await getDb()
    .from("client_sources")
    .delete()
    .eq("id", sourceId)
    .eq("client_id", clientId);
  if (error) throw new Error(`source delete failed: ${error.message}`);
}

export async function listSources(clientId: string): Promise<SourceRow[]> {
  const { data, error } = await getDb()
    .from("client_sources")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`source list failed: ${error.message}`);
  return (data ?? []) as SourceRow[];
}

/** Upserts the single `operator` source (url null) with the intake form. */
export async function saveIntake(clientId: string, form: IntakeForm): Promise<SourceRow> {
  const src = await attachSource(clientId, { kind: "operator", url: null });
  const { data, error } = await getDb()
    .from("client_sources")
    .update({ intake: form })
    .eq("id", src.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`intake save failed: ${error?.message}`);
  return data as SourceRow;
}
