/**
 * api/email/sync/route.ts — POST: pull inbound replies from connected mailboxes.
 *
 * Thin wrapper over lib/pipeline/inbox-sync (runInboxSync). Same logic runs
 * automatically on the Cloud Run job (MODE=inbox); this route powers the manual
 * Inbox "Sync replies" button.
 *
 * Reading only — never sends. Idempotent (dedupes by mailbox + UID).
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { runInboxSync } from "@/lib/pipeline/inbox-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const summary = await runInboxSync();
  return ok(summary);
});
