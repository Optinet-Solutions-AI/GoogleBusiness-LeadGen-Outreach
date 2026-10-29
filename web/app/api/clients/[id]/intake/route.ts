/**
 * api/clients/[id]/intake/route.ts — PUT: save the operator intake form (the `operator` source).
 *
 * Inputs:  params.id; body IntakeForm
 * Outputs: { source } (the operator source row with intake set)
 * Used by: client detail page (Intake form)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { IntakeForm, saveIntake } from "@/lib/clients/sources";

export const PUT = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = IntakeForm.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid intake form", 400);
  if (!(await getClient(params.id))) return fail("client not found", 404);
  return ok({ source: await saveIntake(params.id, parsed.data) });
});
