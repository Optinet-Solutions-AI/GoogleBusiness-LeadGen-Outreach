/**
 * api/test-form/route.ts — the RateUp test contact form posts here.
 *
 * Inputs:  POST { name, email, phone?, subject?, message }
 * Outputs: { saved: true } · 400 with the plain reason when a field is missing
 * Used by: app/(public)/test-form/TestForm.tsx
 *
 * Thin: zod → lib/test-form.ts. Public (it's a contact form), stores text only, nothing is sent anywhere.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { TestFormInput, saveTestFormMessage } from "@/lib/test-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = TestFormInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please fill in the form", 400);
  await saveTestFormMessage(parsed.data);
  return ok({ saved: true });
});
