/**
 * api/inbox/[id]/thread/route.ts — one lead's email thread for the reading pane.
 *
 * Inputs:  params.id (lead uuid)
 * Outputs: { lead, messages[], mailboxes[], form } — enough to render + reply
 * Used by: the Gmail-style inbox reading pane (client fetch on thread select)
 *
 * Opening a thread also marks it read (inbox_read_at = now).
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();

  const { data: lead } = await db
    .from("leads")
    .select(
      "id,business_name,email,phone,stage,website_url,website_kind,primary_offer," +
        "is_favorite,inbox_status,lifecycle_stage",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!lead) return fail("Lead not found", 404);

  const [{ data: messages }, { data: mailboxes }, { data: form }] = await Promise.all([
    db
      .from("email_messages")
      .select("id,direction,subject,body_text,to_addr,from_addr,status,created_at")
      .eq("lead_id", params.id)
      .order("created_at", { ascending: true })
      .limit(500),
    db
      .from("email_accounts")
      .select("email,from_name")
      .eq("status", "active")
      .not("smtp_host", "is", null)
      .order("created_at", { ascending: true }),
    db
      .from("form_submissions")
      .select("answers,created_at")
      .eq("lead_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Opening a thread marks it read.
  await db.from("leads").update({ inbox_read_at: new Date().toISOString() }).eq("id", params.id);

  return ok({
    lead,
    messages: messages ?? [],
    mailboxes: mailboxes ?? [],
    form: form ?? null,
  });
});
