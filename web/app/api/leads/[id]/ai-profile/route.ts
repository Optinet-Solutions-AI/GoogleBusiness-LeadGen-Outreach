/**
 * api/leads/[id]/ai-profile/route.ts — "Research business" (replaced Find contacts + the AI profile window).
 *
 * Inputs:  GET params.id · POST params.id (no body)
 * Outputs: GET  { profile, createdAt } | null — the last saved research (free)
 *          POST { profile, createdAt, filled, saved, aiNote } — one OpenAI web search + a free scan of their own
 *               site (about 2–5 cents, up to a minute)
 * Used by: components/leads/ContactCard.tsx (Research business), components/LeadsTable.tsx (row + bulk Research)
 *
 * Thin: validate → lib/leads/ai-profile.ts.
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { loadAiProfile, runAiProfile } from "@/lib/leads/ai-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  return ok(await loadAiProfile(params.id));
});

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  try {
    return ok(await runAiProfile(params.id));
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/not found/i.test(msg)) return fail("Lead not found", 404);
    if (/OPENAI_API_KEY missing/.test(msg)) return fail("AI research isn't switched on (no OpenAI key). Ask the admin.", 503);
    if (/timeout|abort/i.test(msg)) return fail("The AI search took too long. Try again in a minute.", 504);
    return fail(`Couldn't research this lead: ${msg.slice(0, 160)}`, 502);
  }
});
