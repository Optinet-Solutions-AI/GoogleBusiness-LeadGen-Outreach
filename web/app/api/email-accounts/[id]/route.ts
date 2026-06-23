/**
 * api/email-accounts/[id]/route.ts — manage a connected sending mailbox.
 *
 * PATCH  /api/email-accounts/:id  body { daily_cap } → set a fixed custom daily
 *        send limit (turns off in-app warmup ramp so the value is authoritative).
 * DELETE /api/email-accounts/:id → hard-deletes the email_accounts row.
 * Used by: the Email accounts page (MailboxCapEditor, MailboxRemoveButton).
 *
 * Safe to hard-delete: email_messages.email_account_id is ON DELETE SET NULL, so
 * thread history is preserved (it just loses the mailbox link). A lead whose
 * sequence is pinned to this mailbox (leads.seq_sender_email) will fall back to
 * another active mailbox / soft no-op until re-pointed — it won't send to a
 * deleted account.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = getLogger("api.email-accounts");

const PatchBody = z.object({ daily_cap: z.number().int().min(1).max(2000) });

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = params?.id;
  if (!id) return fail("Missing mailbox id", 400);

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);

  // Setting a custom cap makes it authoritative: disable the warmup ramp so
  // getRampedDailyCap() returns this fixed daily_cap (see email-sender.ts).
  const { data, error } = await getDb()
    .from("email_accounts")
    .update({ daily_cap: parsed.data.daily_cap, warmup_enabled: false, warmup_started_at: null })
    .eq("id", id)
    .select("id,email,daily_cap")
    .maybeSingle();
  if (error) return fail(error.message, 502);
  if (!data) return fail("Mailbox not found", 404);

  revalidatePath("/email-accounts");
  log.info({ id, daily_cap: data.daily_cap }, "email_account.cap_updated");
  return ok({ id: data.id, email: data.email, daily_cap: data.daily_cap });
});

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
