/**
 * api/clients/route.ts — GET: list clients (with source kinds, last job, cost). POST: create a client.
 *
 * Inputs:  POST body { name, website_url?, country_code? }
 * Outputs: { clients } on GET; { client } on POST
 * Used by: Clients dashboard section
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { createClient, listClients } from "@/lib/clients/clients";

const Body = z.object({
  name: z.string().trim().min(1),
  website_url: z.string().trim().url().nullish(),
  country_code: z.string().trim().min(2).max(2).nullish(),
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok({ clients: await listClients() });
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body (name is required)", 400);
  const client = await createClient({
    ...parsed.data,
    country_code: parsed.data.country_code?.toLowerCase() ?? null,
  });
  return ok({ client });
});
