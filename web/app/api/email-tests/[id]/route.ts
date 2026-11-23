/**
 * api/email-tests/[id]/route.ts — end a wording test and keep version A or B.
 *
 * Inputs:  PATCH params.id + { winner: "A" | "B" }
 * Outputs: { success, data: test } · 409 + a plain sentence when it already ended
 * Used by: components/templates/EmailResults.tsx ("Keep A" / "Keep B")
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { endTest, TestError } from "@/lib/email/email-tests";
import { endTestBody } from "@/lib/email/email-tests-request";

export const dynamic = "force-dynamic";

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = endTestBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 422);
  try {
    return ok(await endTest(params.id, parsed.data.winner));
  } catch (err) {
    if (err instanceof TestError) return fail(err.message, err.status);
    throw err;
  }
});
