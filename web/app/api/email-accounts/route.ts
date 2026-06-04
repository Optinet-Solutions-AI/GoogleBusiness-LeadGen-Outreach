/**
 * api/email-accounts/route.ts — GET: active sending mailboxes for the Sender pickers.
 *
 * GET → { mailboxes: [{ email, from_name }] } (active + SMTP-configured only)
 * Used by: the New-campaign wizard's Sender dropdown (email channel).
 * Pure read, no paid calls.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("email_accounts")
    .select("email,from_name")
    .eq("status", "active")
    .not("smtp_host", "is", null)
    .order("created_at", { ascending: true });
  if (error) return fail(error.message, 502);
  return ok({ mailboxes: data ?? [] });
});
