/**
 * api/batches/[id]/email/route.ts — "Email this batch": the preview, then the start.
 *
 * Inputs:  GET ?eu=1&choices=<json offer → "auto"|"saved:<id>"> · POST { dailyLimit, followUps, includeEu, choices }
 * Outputs: GET BatchEmailPlan (who gets an email, who is skipped and why, a sample per offer; free, reads only)
 *          POST { campaignId, enrolled, failed, days, firstAt } — nothing is sent now: the email scheduler sends
 *          each first email at its slot; 409 / 503 + a plain sentence when refused
 * Used by: components/batches/BatchEmailButton.tsx
 *
 * Thin: zod → lib/campaigns/batch-email-plan.ts.
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { BatchEmailError, loadBatchEmailPlan, startBatchEmail } from "@/lib/campaigns/batch-email-plan";
import { parseChoices, startBatchEmailBody } from "@/lib/campaigns/batch-email-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const q = new URL(req.url).searchParams;
  try {
    return ok(await loadBatchEmailPlan(params.id, { includeEu: q.get("eu") === "1", choices: parseChoices(q.get("choices")) }));
  } catch (err) {
    if (err instanceof BatchEmailError) return fail(err.message, err.status);
    throw err;
  }
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = startBatchEmailBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 422);
  try {
    return ok(await startBatchEmail(params.id, parsed.data));
  } catch (err) {
    if (err instanceof BatchEmailError) return fail(err.message, err.status);
    throw err;
  }
});
