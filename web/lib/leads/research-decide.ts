/**
 * leads/research-decide.ts — apply the operator's Verify / Remove on a "Research business" line, or switch the main
 * email / phone to one from the extra list.
 *
 * Inputs:  lead id + { key, action: "verify" | "remove" } (a line from reviewRows) or { use: { kind, value } }
 * Outputs: updates the lead (email / phone / owner / contact page), moves the replaced email / phone into
 *          other_emails / other_phones (migration 062), and records the decision in leads.ai_profile.decisions.
 *          Returns { message } in plain words, or throws a plain-English error.
 * Used by: app/api/leads/[id]/ai-profile/decide/route.ts
 *
 * Never deletes a contact: a replaced email / phone is kept in the extra list. A new main email starts unchecked.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isMissingColumn } from "@/lib/db-errors";
import { verificationResetFor } from "@/lib/verify/email-change";
import { reviewRows, swapIn, samePhone, sameEmailValue, type OtherContact, type ResearchView } from "./research-review";

const log = getLogger("research-decide");

type Row = {
  id: string;
  email: string | null;
  phone: string | null;
  contact_owner_name: string | null;
  contact_owner_role: string | null;
  contact_page_url: string | null;
  ai_profile: ResearchView | null;
};

export type DecideInput = { key: string; action: "verify" | "remove" } | { use: { kind: "email" | "phone"; value: string } };

const NEEDS_062 = "Keeping more than one email or phone needs database update 062 first. Nothing was changed.";

async function loadOthers(leadId: string): Promise<{ emails: OtherContact[]; phones: OtherContact[] } | null> {
  const { data, error } = await getDb().from("leads").select("other_emails,other_phones").eq("id", leadId).maybeSingle();
  if (error) {
    if (isMissingColumn(error, "other_emails") || isMissingColumn(error, "other_phones")) return null;
    throw new Error(error.message);
  }
  const r = data as { other_emails: OtherContact[] | null; other_phones: OtherContact[] | null } | null;
  return { emails: r?.other_emails ?? [], phones: r?.other_phones ?? [] };
}

/** The patch that makes `value` the main email / phone and keeps the old one in the extra list. */
async function mainContactPatch(lead: Row, kind: "email" | "phone", value: string): Promise<Record<string, unknown>> {
  const others = await loadOthers(lead.id);
  if (!others) throw new Error(NEEDS_062);
  if (kind === "email") {
    return {
      ...verificationResetFor(lead.email, value),
      email: value,
      other_emails: swapIn(others.emails, lead.email, value, sameEmailValue),
    };
  }
  return { phone: value, other_phones: swapIn(others.phones, lead.phone, value, samePhone) };
}

export async function decideResearch(leadId: string, input: DecideInput): Promise<{ message: string }> {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("id,email,phone,contact_owner_name,contact_owner_role,contact_page_url,ai_profile")
    .eq("id", leadId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error, "ai_profile")) throw new Error("Research results need database update 061 first.");
    throw new Error(error.message);
  }
  const lead = data as Row | null;
  if (!lead) throw new Error("Lead not found");

  // "Use this" on an extra email / phone from the Contact card.
  if ("use" in input) {
    const patch = await mainContactPatch(lead, input.use.kind, input.use.value.trim());
    const { error: e } = await db.from("leads").update(patch).eq("id", leadId);
    if (e) throw new Error(e.message);
    return { message: `${input.use.value} is now the main ${input.use.kind}. The previous one is kept under More ${input.use.kind}s.` };
  }

  const profile = lead.ai_profile;
  if (!profile) throw new Error("No research results for this lead yet. Click Research business first.");
  const row = reviewRows(profile, lead).find((r) => r.key === input.key);
  if (!row) throw new Error("That detail isn't in the research results any more. Refresh the page.");

  const patch: Record<string, unknown> = {};
  let message = input.action === "remove" ? `${row.label} removed from the research results.` : `${row.label} marked as checked.`;
  if (input.action === "verify") {
    if (row.kind === "email" || row.kind === "phone") {
      Object.assign(patch, await mainContactPatch(lead, row.kind, row.value));
      message = `${row.value} is now the main ${row.kind}.${(row.kind === "email" ? lead.email : lead.phone) ? " The previous one is kept under More " + row.kind + "s." : ""}`;
    } else if (row.kind === "owner") {
      patch.contact_owner_name = profile.owner_name;
      patch.contact_owner_role = profile.owner_role;
      message = `${row.value} saved as the contact person.`;
    } else if (row.kind === "contact_page") {
      patch.contact_page_url = row.value;
      message = "Contact page saved.";
    }
  }
  patch.ai_profile = { ...profile, decisions: { ...(profile.decisions ?? {}), [row.key]: input.action === "verify" ? "verified" : "removed" } };

  const { error: uErr } = await db.from("leads").update(patch).eq("id", leadId);
  if (uErr) throw new Error(uErr.message);
  log.info({ lead_id: leadId, key: row.key, action: input.action }, "research.decided");
  return { message };
}
