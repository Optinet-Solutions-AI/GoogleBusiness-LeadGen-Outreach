/**
 * api/leads/[id]/website-review/route.ts — the lead page's "Check website again".
 *
 * Inputs:  GET params.id · POST params.id (no body)
 * Outputs: GET  { review: leads.website_review | null } (free; the button polls it while checking)
 *          POST { started: true } (202) — marks the lead as checking and starts Cloud Run MODE=website-review;
 *               409 with the plain reason when refused, 503 when Cloud Run isn't set up
 * Used by: components/leads/WebsiteCheckButton.tsx
 *
 * Thin: lib/leads/website-recheck-run.ts. Paid: one OpenAI website check, about 1 cent.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { isMissingColumn } from "@/lib/db-errors";
import { getLogger } from "@/lib/logger";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import { MISSING_069, markRecheckFailed, startRecheck } from "@/lib/leads/website-recheck-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("api.leads.website-review");

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const { data, error } = await getDb().from("leads").select("website_review").eq("id", params.id).maybeSingle();
  if (error) return isMissingColumn(error, "website_review") ? fail(MISSING_069, 409) : fail(error.message, 500);
  return ok({ review: (data as { website_review?: unknown } | null)?.website_review ?? null });
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  if (!isCloudRunConfigured()) return fail("The website check needs the Cloud Run worker (not available locally).", 503);
  const started = await startRecheck(params.id);
  if (!started.ok) return fail(started.message, started.status);
  const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
  try {
    await triggerJob({ MODE: "website-review", LEAD_ID: params.id }, { oidcToken, timeoutSeconds: 300 });
  } catch (err) {
    log.error({ lead_id: params.id, err: String(err) }, "website_review.trigger_failed");
    await markRecheckFailed(params.id, "Couldn't start the check. Try again.");
    return fail("Couldn't start the check. Try again.", 502);
  }
  return ok({ started: true }, { status: 202 });
});
