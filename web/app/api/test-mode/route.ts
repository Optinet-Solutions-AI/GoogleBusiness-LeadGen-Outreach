/**
 * api/test-mode/route.ts — the Test list: who may receive emails, contact forms and AI calls while Test mode is on.
 *
 * Inputs:  GET  —
 *          POST { action: "add" | "remove", kind: "email" | "phone", value }
 * Outputs: GET  { on, emails, phones, hosts } · POST the updated list; 409 + plain reason when refused (not an email,
 *          no country code, already on the list, setting unreadable)
 * Used by: components/TestListClient.tsx
 *
 * Thin: zod → lib/test-mode.ts. There is deliberately no way to switch Test mode off here (operator only, by asking),
 * and the website list (the RateUp test form) is not editable here either.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { editTestList, getTestMode, resetTestModeCache } from "@/lib/test-mode";

const Body = z.object({
  action: z.enum(["add", "remove"]),
  kind: z.enum(["email", "phone"]),
  value: z.string().trim().min(3, "Type the email or the phone number").max(120),
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  resetTestModeCache();
  return ok(await getTestMode());
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const r = await editTestList(parsed.data.action, parsed.data.kind, parsed.data.value);
  return r.ok ? ok(r.mode) : fail(r.message, 409);
});
