/**
 * api/leads/send/route.ts — Bulk "Send via best channel" for selected leads.
 *
 * POST { leadIds: string[], dryRun?: boolean, resend?: boolean }
 *   dryRun → routing breakdown only (no sends, for the confirm preview)
 *   real   → routes + sends each lead via its channel (email/SMS), returns a summary
 * Used by: the Leads page bulk action.
 *
 * Each lead: already-outreached → skip; email if present → email; else phone → SMS; else skip.
 * $0 until a mailbox/SMS key is connected (the stages soft-no-op). Cap 100/request; concurrency 6.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { chooseChannel, sendViaBestChannel, type RoutableLead } from "@/lib/outreach/route-send";

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 100;
const CONCURRENCY = 6;

const Body = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(MAX_PER_REQUEST),
  dryRun: z.boolean().default(false),
  resend: z.boolean().default(false),
});

const SELECT = "id,business_name,email,phone,demo_url,primary_offer,lifecycle_stage,stage";

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(", "), 400);
  const { leadIds, dryRun, resend } = parsed.data;

  const { data, error } = await getDb().from("leads").select(SELECT).in("id", leadIds);
  if (error) return fail(error.message, 502);
  const leads = (data ?? []) as RoutableLead[];

  const summary = {
    total: leads.length,
    emailed: 0,
    texted: 0,
    skipped_no_contact: 0,
    skipped_already: 0,
    skipped_suppressed: 0,
    failed: 0,
    dry_run: dryRun,
  };

  if (dryRun) {
    for (const lead of leads) {
      const { channel, reason } = chooseChannel(lead, { resend });
      if (channel === "email") summary.emailed += 1;
      else if (channel === "sms") summary.texted += 1;
      else if (reason === "already") summary.skipped_already += 1;
      else summary.skipped_no_contact += 1;
    }
    return ok(summary);
  }

  // Real run — send with bounded concurrency.
  const queue = [...leads];
  const tally = (o: Awaited<ReturnType<typeof sendViaBestChannel>>) => {
    if (o.skipped === "suppressed") summary.skipped_suppressed += 1;
    else if (o.reason === "already" || o.skipped === "already_sent") summary.skipped_already += 1;
    else if (o.reason === "no_contact" || o.skipped === "no_contact") summary.skipped_no_contact += 1;
    else if (o.skipped) summary.failed += 1;
    else if (o.channel === "email") summary.emailed += 1;
    else if (o.channel === "sms") summary.texted += 1;
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const lead = queue.shift();
      if (!lead) break;
      tally(await sendViaBestChannel(lead, { resend }));
    }
  });
  await Promise.all(workers);

  return ok(summary);
});
