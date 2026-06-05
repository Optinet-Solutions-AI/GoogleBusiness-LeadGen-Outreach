/**
 * verify-lead.ts — verify one lead's email and persist the verdict + audit trail.
 * Inputs:  a lead { id, email }. Outputs: writes verification_* columns. Used by:
 * the Cloud Run verify job, the CLI, and /api/verify/sync.
 */
import { getDb } from "../db";
import { getLogger } from "../logger";
import { verifyEmail } from "../services/email-validator";
import type { VerifyResult } from "../services/email-validator/types";

const log = getLogger("verify-lead");

export function buildLeadUpdate(r: VerifyResult, verifiedAt: string) {
  return {
    verification_status: r.status,
    email_verified: r.status === "valid",
    verified_at: verifiedAt,
    verify_syntax_ok: r.audit.syntax_ok,
    verify_mx_ok: r.audit.mx_ok,
    verify_smtp_result: r.audit.smtp_result,
    verify_zerobounce_result: r.audit.zerobounce_result,
    verify_millionverifier_result: r.audit.millionverifier_result,
    verify_hunter_result: r.audit.hunter_result,
  };
}

export async function verifyLead(
  lead: { id: string; email: string | null },
  opts: { smtpEnabled?: boolean } = {},
): Promise<VerifyResult | null> {
  if (!lead.email) return null;
  const result = await verifyEmail(lead.email, opts).catch((e) => {
    log.warn({ lead_id: lead.id, err: String(e) }, "verify-lead.error");
    return null;
  });
  if (!result) return null;
  await getDb().from("leads").update(buildLeadUpdate(result, new Date().toISOString())).eq("id", lead.id);
  return result;
}

/** Verify up to `limit` unverified leads (those with an email + no/false verdict). */
export async function verifyUnverifiedLeads(
  limit = 500,
  opts: { smtpEnabled?: boolean } = {},
): Promise<{ verified: number; byStatus: Record<string, number> }> {
  const { data } = await getDb()
    .from("leads")
    .select("id,email")
    .not("email", "is", null)
    .neq("email", "")
    .eq("email_verified", false)
    .limit(limit);
  const leads = (data ?? []) as { id: string; email: string | null }[];
  const byStatus: Record<string, number> = {};
  for (const lead of leads) {
    const r = await verifyLead(lead, opts);
    if (r) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  log.info({ verified: leads.length, byStatus }, "verify.batch.done");
  return { verified: leads.length, byStatus };
}
