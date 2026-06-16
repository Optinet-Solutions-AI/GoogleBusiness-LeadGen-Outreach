/**
 * api/email-accounts/[id]/route.ts — DELETE: remove a connected sending mailbox.
 *
 * DELETE /api/email-accounts/:id → hard-deletes the email_accounts row.
 * Used by: the "Remove" button on the Email accounts page (MailboxRemoveButton).
 *
 * Safe to hard-delete: email_messages.email_account_id is ON DELETE SET NULL, so
 * thread history is preserved (it just loses the mailbox link). A lead whose
 * sequence is pinned to this mailbox (leads.seq_sender_email) will fall back to
 * another active mailbox / soft no-op until re-pointed — it won't send to a
 * deleted account.
 */

import { revalidatePath } from "next/cache";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = getLogger("api.email-accounts.delete");

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = params?.id;
  if (!id) return fail("Missing mailbox id", 400);

  const { data, error } = await getDb()
    .from("email_accounts")
    .delete()
    .eq("id", id)
    .select("email")
    .maybeSingle();
  if (error) return fail(error.message, 502);
  if (!data) return fail("Mailbox not found", 404);

  // Drop the cached Email-accounts page render so the row disappears immediately.
  revalidatePath("/email-accounts");

  log.info({ id, email: data.email }, "email_account.removed");
  return ok({ removed: true, id, email: data.email });
});
