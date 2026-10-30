/**
 * api/email-accounts/[id]/route.ts — manage a connected sending mailbox.
 *
 * PATCH  /api/email-accounts/:id  body { daily_cap } → set a fixed custom daily
 *        send limit (turns off in-app warmup ramp so the value is authoritative).
 * PATCH  /api/email-accounts/:id  body { email_provider: 'smtp' | 'ongage' } → send this
 *        mailbox's email over its own SMTP or through Ongage (refused while Ongage isn't configured).
 * DELETE /api/email-accounts/:id → hard-deletes the email_accounts row.
 * Used by: the Email accounts page (MailboxCapEditor, MailboxSendViaToggle, MailboxRemoveButton).
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
import { isOngageConfigured } from "@/lib/services/ongage";

export const dynamic = "force-dynamic";

const log = getLogger("api.email-accounts");

const PatchBody = z.union([
  z.object({ daily_cap: z.number().int().min(1).max(2000) }),
  z.object({ email_provider: z.enum(["smtp", "ongage"]) }),
]);

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = params?.id;
  if (!id) return fail("Missing mailbox id", 400);

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);

  if ("email_provider" in parsed.data) {
    const provider = parsed.data.email_provider;
    if (provider === "ongage" && !isOngageConfigured()) {
      return fail("Ongage isn't set up yet: add ONGAGE_API_KEY and ONGAGE_TRANSACTIONAL_CAMPAIGN_ID first.", 409);
    }
    const { data, error } = await getDb()
      .from("email_accounts")
      .update({ email_provider: provider })
      .eq("id", id)
      .select("id,email,email_provider")
      .maybeSingle();
    if (error) return fail(error.message, 502);
    if (!data) return fail("Mailbox not found", 404);
    revalidatePath("/email-accounts");
    log.info({ id, email_provider: data.email_provider }, "email_account.provider_updated");
    return ok({ id: data.id, email: data.email, email_provider: data.email_provider });
  }

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
