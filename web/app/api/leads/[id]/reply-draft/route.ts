/**
 * api/leads/[id]/reply-draft/route.ts — "Draft with AI" / "Redraft" on an Inbox thread (27 Nov 2026).
 *
 * Inputs:  POST params.id (no body)
 * Outputs: { draft } — one OpenAI call on the lead's latest reply (~1 cent, a few seconds); 429 within a minute of the
 *          last draft; 404 when there's no reply; 503 when OpenAI or migration 078 is missing
 * Used by: components/inbox/ReplyAiBox.tsx
 *
 * Thin: lib/email/reply-ai-run.ts redraftLatest. The AI only drafts; nothing is sent. workflows/handle_replies_with_ai.md.
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { BrainError } from "@/lib/services/openai-brain";
import { redraftLatest, RedraftTooSoonError } from "@/lib/email/reply-ai-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  try {
    return ok({ draft: await redraftLatest(params.id) });
  } catch (err) {
    if (err instanceof RedraftTooSoonError) return fail(err.message, 429);
    if (err instanceof BrainError) {
      if (err.code === "not_configured") return fail("AI drafting isn't switched on (no OpenAI key). Ask the admin.", 503);
      if (err.code === "key_invalid" || err.code === "no_credit") return fail("OpenAI refused the request (key or credit). Ask the admin.", 503);
    }
    const msg = String(err instanceof Error ? err.message : err);
    if (/ai_state|ai_attempts|ai_at/.test(msg)) return fail("Run database update 078 first (AI reply handling).", 503);
    if (msg === "No reply to draft yet.") return fail(msg, 404);
    return fail(msg.slice(0, 200), 502);
  }
});
