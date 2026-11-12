/**
 * email/enroll-lead.ts — start a lead's email sequence, checking its address first when it was never checked.
 *
 * Inputs:  lead id (+ injectable deps for tests)
 * Outputs: EnrollResult + `verification` (the status after any check). Writes verification_* via verifyLead and
 *          seq_* via enrollLeadInSequence.
 * Used by: app/api/leads/[id]/sequence/route.ts (the Send email preview's Send button)
 *
 * Without this, an unchecked address was enrolled and then held by the sequence every day, so nothing was ever
 * sent and nobody was told. Now the operator's click verifies first (ZeroBounce ladder, under 1 cent) when the
 * status is empty or "unknown"; a decided status (valid / catch-all / invalid) is never re-checked.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { verifyLead } from "@/lib/verify/verify-lead";
import { verificationActive } from "@/lib/services/email-validator";
import { enrollLeadInSequence, type EnrollResult, type LeadCopy } from "@/lib/pipeline/sequence-scheduler";

type LeadRow = { id: string; email: string | null; verification_status: string | null };

export type EnrollDeps = {
  load: (id: string) => Promise<LeadRow | null>;
  verify: (lead: { id: string; email: string | null }) => Promise<{ status: string } | null>;
  enroll: (id: string, opts: { copy?: LeadCopy | null; requireCopy?: boolean; allowNoDemo?: boolean }) => Promise<EnrollResult>;
  verificationOn: () => boolean;
};

const defaultDeps: EnrollDeps = {
  load: async (id) => {
    const { data } = await getDb().from("leads").select("id,email,verification_status").eq("id", id).maybeSingle();
    return (data as LeadRow | null) ?? null;
  },
  verify: verifyLead,
  enroll: (id, opts) => enrollLeadInSequence(id, undefined, opts),
  verificationOn: verificationActive,
};

/** Does this status still need a check before sending? Pure. */
export function needsCheck(status: string | null | undefined): boolean {
  return !status || status === "unknown";
}

export async function enrollWithVerification(
  leadId: string,
  deps: EnrollDeps = defaultDeps,
  opts: { copy?: LeadCopy | null; requireCopy?: boolean; allowNoDemo?: boolean } = {},
): Promise<EnrollResult & { verification: string | null; checked: boolean }> {
  const lead = await deps.load(leadId);
  if (!lead) throw new Error(`lead not found: ${leadId}`);
  let status = lead.verification_status;
  let checked = false;
  if (lead.email && deps.verificationOn() && needsCheck(status)) {
    const r = await deps.verify({ id: lead.id, email: lead.email });
    if (r) {
      status = r.status;
      checked = true;
    }
  }
  const result = await deps.enroll(leadId, opts);
  return { ...result, verification: status, checked };
}
