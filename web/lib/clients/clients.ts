/**
 * clients.ts — CRUD for `clients` (the Brand Brain subjects) + lead-to-client conversion.
 *
 * Inputs:  client fields, lead id
 * Outputs: clients rows, list rows with source kinds / last job / cost aggregates
 * Used by: /api/clients*, /api/leads/[id]/client, later Brand Brain pipeline stages
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import type { ClientStatus, SourceKind } from "./types";
import { attachSource, autoSourcesForLead } from "./sources";

export type ClientRow = {
  id: string;
  lead_id: string | null;
  name: string;
  status: ClientStatus;
  website_url: string | null;
  country_code: string | null;
  timezone: string | null;
  notes: string | null;
  brain_started_at: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
};

export type ClientListRow = ClientRow & {
  source_kinds: SourceKind[];
  last_job_at: string | null;
  cost_usd: number;
};

export async function createClient(input: {
  name: string;
  website_url?: string | null;
  lead_id?: string | null;
  country_code?: string | null;
}): Promise<ClientRow> {
  const { data, error } = await getDb()
    .from("clients")
    .insert({
      name: input.name,
      website_url: input.website_url ?? null,
      lead_id: input.lead_id ?? null,
      country_code: input.country_code ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`client insert failed: ${error?.message}`);
  const client = data as ClientRow;
  if (client.website_url) await attachSource(client.id, { kind: "website", url: client.website_url });
  return client;
}

/** Idempotent on clients.lead_id. Throws "lead not found" when the lead is missing. */
export async function createClientFromLead(
  leadId: string,
): Promise<{ client: ClientRow; created: boolean }> {
  const db = getDb();
  const { data: lead, error: lErr } = await db
    .from("leads")
    .select("id,business_name,country_code,website_url,website_kind,demo_url")
    .eq("id", leadId)
    .maybeSingle();
  if (lErr) throw new Error(`lead lookup failed: ${lErr.message}`);
  if (!lead) throw new Error("lead not found");

  const attachAll = async (clientId: string) => {
    for (const s of autoSourcesForLead(lead)) await attachSource(clientId, s); // idempotent
  };

  const { data: existing } = await db.from("clients").select("*").eq("lead_id", leadId).maybeSingle();
  if (existing) {
    await attachAll((existing as ClientRow).id); // heals a partial earlier failure
    return { client: existing as ClientRow, created: false };
  }

  const realSite = lead.website_kind === "real" ? (lead.website_url as string | null) : null;
  const { data, error } = await db
    .from("clients")
    .insert({
      lead_id: leadId,
      name: lead.business_name,
      country_code: lead.country_code ?? null,
      website_url: realSite,
    })
    .select("*")
    .single();
  if (error?.code === "23505") {
    // Lost a race with a concurrent call for the same lead: re-read the winner.
    const { data: winner } = await db.from("clients").select("*").eq("lead_id", leadId).maybeSingle();
    if (winner) {
      await attachAll((winner as ClientRow).id);
      return { client: winner as ClientRow, created: false };
    }
  }
  if (error || !data) throw new Error(`client insert failed: ${error?.message}`);
  const client = data as ClientRow;
  await attachAll(client.id);
  return { client, created: true };
}

export async function listClients(): Promise<ClientListRow[]> {
  const db = getDb();
  const { data: clients, error } = await db
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`client list failed: ${error.message}`);
  const [{ data: srcs }, { data: jobs }] = await Promise.all([
    db.from("client_sources").select("client_id,kind"),
    db.from("generation_jobs").select("client_id,cost_usd,started_at,finished_at"),
  ]);
  const kinds = new Map<string, Set<SourceKind>>();
  for (const s of srcs ?? []) {
    const set = kinds.get(s.client_id) ?? new Set<SourceKind>();
    set.add(s.kind as SourceKind);
    kinds.set(s.client_id, set);
  }
  const agg = new Map<string, { last: string | null; cost: number }>();
  for (const j of jobs ?? []) {
    const a = agg.get(j.client_id) ?? { last: null, cost: 0 };
    const at = (j.finished_at ?? j.started_at) as string | null;
    if (at && (!a.last || at > a.last)) a.last = at;
    a.cost += Number(j.cost_usd ?? 0);
    agg.set(j.client_id, a);
  }
  return ((clients ?? []) as ClientRow[]).map((c) => ({
    ...c,
    source_kinds: [...(kinds.get(c.id) ?? [])],
    last_job_at: agg.get(c.id)?.last ?? null,
    cost_usd: agg.get(c.id)?.cost ?? 0,
  }));
}

export async function getClient(id: string): Promise<ClientRow | null> {
  const { data, error } = await getDb().from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`client lookup failed: ${error.message}`);
  return (data as ClientRow | null) ?? null;
}

export async function updateClient(
  id: string,
  patch: { name?: string; status?: ClientStatus; notes?: string | null; website_url?: string | null },
): Promise<ClientRow | null> {
  const { data, error } = await getDb()
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`client update failed: ${error.message}`);
  return (data as ClientRow | null) ?? null;
}

/** DB cascades remove child rows; the Storage folder is removed best-effort. */
export async function deleteClient(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("clients").delete().eq("id", id);
  if (error) throw new Error(`client delete failed: ${error.message}`);
  try {
    const bucket = db.storage.from("client-assets");
    const { data: files } = await bucket.list(id);
    if (files?.length) await bucket.remove(files.map((f) => `${id}/${f.name}`));
  } catch {
    /* bucket may not exist yet */
  }
}
