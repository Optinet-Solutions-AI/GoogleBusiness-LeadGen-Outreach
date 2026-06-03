/**
 * api/voice/test-calls/[id]/route.ts — Delete one saved test call.
 *
 * DELETE (id in path) → removes that saved conversation from History.
 * Used by: components/SavedTestCalls.tsx ("Delete this call").
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const DELETE = withApi(async (_req, ctx) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = ctx?.params?.id;
  if (!id) return fail("Missing id", 400);
  const { error } = await getDb().from("test_calls").delete().eq("id", id);
  if (error) return fail(error.message, 502);
  return ok({ deleted: true });
});
