/**
 * api/leads/[id]/ai-profile/decide/route.ts — Verify / Remove one "Research business" detail, or switch the main
 * email / phone to an extra one.
 *
 * Inputs:  POST { key, action: "verify" | "remove" } | { use: { kind: "email" | "phone", value } }
 * Outputs: { message } — plain words for the toast; 409 + plain reason when it can't be applied
 * Used by: components/leads/ResearchPanel.tsx, components/leads/ContactCard.tsx ("Use this")
 *
 * Thin: validate → lib/leads/research-decide.ts. Free (no paid calls).
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { decideResearch } from "@/lib/leads/research-decide";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ key: z.string().min(1).max(300), action: z.enum(["verify", "remove"]) }),
  z.object({ use: z.object({ kind: z.enum(["email", "phone"]), value: z.string().trim().min(3).max(200) }) }),
]);

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request", 400);
  try {
    return ok(await decideResearch(params.id, parsed.data));
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/not found/i.test(msg)) return fail("Lead not found", 404);
    return fail(msg.slice(0, 240), 409);
  }
});
