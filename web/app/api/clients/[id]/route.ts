/**
 * api/clients/[id]/route.ts — GET: client + sources + profile versions. PATCH: edit. DELETE: remove.
 *
 * Inputs:  params.id; PATCH body { name?, status?, notes?, website_url? }
 * Outputs: { client, sources, current_profile_version, draft_version, brain_started_at } on GET
 * Used by: client detail page (polls GET while brain_started_at is set)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { deleteClient, getClient, updateClient } from "@/lib/clients/clients";
import { listSources } from "@/lib/clients/sources";
import { ClientStatus } from "@/lib/clients/types";

const Patch = z.object({
  name: z.string().trim().min(1).optional(),
  status: ClientStatus.optional(),
  notes: z.string().nullable().optional(),
  website_url: z.string().trim().url().nullable().optional(),
});

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const client = await getClient(params.id);
  if (!client) return fail("client not found", 404);
  const sources = await listSources(params.id);
  const { data: versions } = await getDb()
    .from("brand_profiles")
    .select("version,state")
    .eq("client_id", params.id)
    .in("state", ["current", "pending_review"])
    .order("version", { ascending: false });
  const rows = (versions ?? []) as { version: number; state: string }[];
  return ok({
    client,
    sources,
    current_profile_version: rows.find((r) => r.state === "current")?.version ?? null,
    draft_version: rows.find((r) => r.state === "pending_review")?.version ?? null,
    brain_started_at: client.brain_started_at,
  });
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const client = await updateClient(params.id, parsed.data);
  if (!client) return fail("client not found", 404);
  return ok({ client });
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  await deleteClient(params.id);
  return ok({ deleted: true });
});
