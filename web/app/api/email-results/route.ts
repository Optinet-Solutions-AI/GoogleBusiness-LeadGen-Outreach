/**
 * api/email-results/route.ts — the Templates page's Results: which emails get replies, and the wording tests.
 *
 * Inputs:  GET ?days=30|90|all (default 30)
 * Outputs: { success, data: { rows, tests, testsMissing } } (lib/email/email-results-load.ts); free, reads only
 * Used by: components/templates/EmailResults.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { loadEmailResults, type Period } from "@/lib/email/email-results-load";

export const dynamic = "force-dynamic";

const PERIODS = new Set<Period>(["30", "90", "all"]);

export const GET = withApi(async (req: Request) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const days = new URL(req.url).searchParams.get("days") ?? "30";
  if (!PERIODS.has(days as Period)) return fail("days must be 30, 90 or all", 400);
  return ok(await loadEmailResults(days as Period));
});
