/**
 * api/leads/[id]/route.ts — Inspect / hand-edit one lead.
 *
 * GET   /api/leads/:id   → full row
 * PATCH /api/leads/:id   body: { email?, brand_color?, stage?, notes? }
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !data) return fail("not found", 404);
  return ok(data);
});

const PatchBody = z.object({
  email: z.string().email().nullable().optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  stage: z.string().optional(),
  notes: z.string().max(4000).optional(),
  // Only `null` is accepted — clients can clear the in-progress flag once
  // their polling loop confirms the rebuild finished. They cannot SET it
  // from the client (only the regenerate API does that).
  rebuild_started_at: z.null().optional(),
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  const payload = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(payload).length === 0) return fail("no fields to update", 400);

  const { error } = await getDb().from("leads").update(payload).eq("id", params.id);
  if (error) return fail(error.message, 500);
  return ok({ id: params.id, updated: payload });
});
