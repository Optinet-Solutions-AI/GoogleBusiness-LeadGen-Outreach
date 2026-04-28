/**
 * api/leads/[id]/route.ts — Inspect / hand-edit one lead.
 *
 * GET   /api/leads/:id   → full row
 * PATCH /api/leads/:id   body: { email?, brand_color?, stage? }
 */

import { z } from "zod";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { data, error } = await getDb()
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !data) return fail("not found", 404);
  return ok(data);
}

const PatchBody = z.object({
  email: z.string().email().nullable().optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  stage: z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
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
}
