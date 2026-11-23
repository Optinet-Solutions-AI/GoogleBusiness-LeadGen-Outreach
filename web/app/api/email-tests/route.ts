/**
 * api/email-tests/route.ts — list wording tests / start one (migration 066).
 *
 * Inputs:  GET · POST { service_key, a_key, b_key } (a_key = "service:<offer>" or "saved:<id>", b_key = "saved:<id>")
 * Outputs: { success, data: { tests, missing } } · { success, data: test } · 409 / 503 + a plain sentence when refused
 * Used by: components/templates/EmailResults.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { listTests, startTest, TestError } from "@/lib/email/email-tests";
import { startTestBody } from "@/lib/email/email-tests-request";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isDbConfigured()) return ok({ tests: [], missing: true });
  return ok(await listTests());
});

export const POST = withApi(async (req: Request) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = startTestBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 422);
  try {
    return ok(await startTest(parsed.data));
  } catch (err) {
    if (err instanceof TestError) return fail(err.message, err.status);
    throw err;
  }
});
