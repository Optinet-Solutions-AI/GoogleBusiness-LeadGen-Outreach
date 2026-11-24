/**
 * website-recheck-run.ts — "Check website again": mark a lead as checking, and run the check on Cloud Run.
 *
 * Inputs:  lead id
 * Outputs: startRecheck → { ok } | { ok: false, message, status } (leads.website_review.pending_at set);
 *          runRecheck (Cloud Run MODE=website-review) → the lead's verdict, pitch and website_review updated,
 *          or website_review.error when their site didn't load
 * Used by: app/api/leads/[id]/website-review/route.ts, scripts/cloud-run-job.ts
 *
 * Rules: lib/leads/website-recheck.ts. The check itself: lib/services/website-review.ts (about 1 cent).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { isMissingColumn } from "@/lib/db-errors";
import { getLogger } from "@/lib/logger";
import { reviewWebsite } from "@/lib/services/website-review";
import { recheckPatch, recheckRefusal, type RecheckLead } from "./website-recheck";

const log = getLogger("website-recheck");
export const MISSING_069 = "The website check needs database update 069. Ask the developer to run it.";

type Row = RecheckLead & {
  id: string;
  business_name: string | null;
  category: string | null;
  address: string | null;
  country_code: string | null;
};

const COLS = "id,business_name,category,address,country_code,website_url,signal_type,website_review";

async function loadLead(leadId: string): Promise<Row | "missing_column" | null> {
  const { data, error } = await getDb().from("leads").select(COLS).eq("id", leadId).maybeSingle();
  if (error) {
    if (isMissingColumn(error, "website_review")) return "missing_column";
    throw new Error(error.message);
  }
  return (data as Row | null) ?? null;
}

export async function startRecheck(
  leadId: string,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const lead = await loadLead(leadId);
  if (lead === "missing_column") return { ok: false, message: MISSING_069, status: 409 };
  if (!lead) return { ok: false, message: "Lead not found.", status: 404 };
  const refusal = recheckRefusal(lead, now);
  if (refusal) return { ok: false, message: refusal, status: 409 };
  const { error } = await getDb()
    .from("leads")
    .update({ website_review: { ...(lead.website_review ?? {}), pending_at: now.toISOString(), error: null } })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** The worker couldn't be started: clear the "checking" mark so the button works again. */
export async function markRecheckFailed(leadId: string, message: string): Promise<void> {
  const lead = await loadLead(leadId).catch(() => null);
  if (!lead || lead === "missing_column") return;
  await getDb()
    .from("leads")
    .update({ website_review: { ...(lead.website_review ?? {}), pending_at: null, error: message } })
    .eq("id", leadId);
}

export async function runRecheck(leadId: string): Promise<void> {
  const lead = await loadLead(leadId);
  if (lead === "missing_column") throw new Error(MISSING_069);
  if (!lead || !lead.website_url) throw new Error(`lead ${leadId} has no website`);
  let review = null;
  try {
    review = await reviewWebsite({
      key: lead.id,
      url: lead.website_url,
      business_name: lead.business_name ?? "",
      category: lead.category,
      city: lead.address,
      country_code: lead.country_code,
    });
  } catch (err) {
    log.warn({ lead_id: leadId, err: String(err).slice(0, 200) }, "website_recheck.failed");
  }
  const db = getDb();
  if (!review) {
    await db
      .from("leads")
      .update({
        website_review: {
          ...(lead.website_review ?? {}),
          pending_at: null,
          error: "Their website didn't load (or the AI check failed), so it couldn't be checked. Try again later.",
        },
      })
      .eq("id", leadId);
    return;
  }
  const { error } = await db.from("leads").update(recheckPatch(review)).eq("id", leadId);
  if (error) throw new Error(error.message);
  log.info({ lead_id: leadId, verdict: review.verdict, score: review.score, usd: review.usd }, "website_recheck.done");
}
