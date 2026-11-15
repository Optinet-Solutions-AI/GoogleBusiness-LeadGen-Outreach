/**
 * leads/ai-profile.ts — the lead page "AI profile": research the business with OpenAI and keep what it found.
 *
 * Inputs:  lead id
 * Outputs: runAiProfile → the profile + which contact fields it filled; saves leads.ai_profile / ai_profile_at
 *          (migration 061), fills email / phone / owner / contact page only where the lead has none (never
 *          overwrites), merges contact_sources, and adds a CRM timeline note (lead_notes) with the summary.
 *          loadAiProfile → the last saved profile (free).
 * Used by: app/api/leads/[id]/ai-profile/route.ts
 *
 * Paid: one OpenAI web search, about 2–5 cents. Tolerates migration 061 / 054 not applied (the result still shows).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isMissingColumn } from "@/lib/db-errors";
import { profileWithAI, type AiProfile } from "@/lib/services/openai-profile";
import { verificationResetFor } from "@/lib/verify/email-change";
import { profileNote } from "./ai-profile-view";

const log = getLogger("ai-profile");

export interface AiProfileResult {
  profile: AiProfile;
  createdAt: string;
  /** Contact fields this run added to the lead, in words ("email", "owner", …). */
  filled: string[];
  /** False when migration 061 isn't applied: shown now, not kept for next time. */
  saved: boolean;
}

type Row = {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  website_url: string | null;
  email: string | null;
  phone: string | null;
  contact_page_url: string | null;
  contact_owner_name: string | null;
  contact_owner_role: string | null;
  contact_sources: string[] | null;
};

/** Which empty contact fields the profile can fill. Pure. Never overwrites what the lead already has. */
export function contactFill(lead: Row, p: AiProfile): { patch: Record<string, unknown>; filled: string[] } {
  const patch: Record<string, unknown> = {};
  const filled: string[] = [];
  if (!lead.email && p.emails[0]) {
    // A new address starts unchecked (never inherits an older address's verdict).
    Object.assign(patch, verificationResetFor(lead.email, p.emails[0]), { email: p.emails[0] });
    filled.push("email");
  }
  if (!lead.phone && p.phones[0]) {
    patch.phone = p.phones[0];
    filled.push("phone");
  }
  if (!lead.contact_owner_name && p.owner_name) {
    patch.contact_owner_name = p.owner_name;
    patch.contact_owner_role = p.owner_role;
    filled.push("owner");
  }
  if (!lead.contact_page_url && p.contact_url) {
    patch.contact_page_url = p.contact_url;
    filled.push("contact page");
  }
  if (filled.length) {
    patch.contact_sources = [...new Set([...(lead.contact_sources ?? []), ...p.sources])].slice(0, 20);
  }
  return { patch, filled };
}

export async function runAiProfile(leadId: string): Promise<AiProfileResult> {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("id,business_name,address,country_code,category,website_url,email,phone,contact_page_url,contact_owner_name,contact_owner_role,contact_sources")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const lead = data as Row | null;
  if (!lead) throw new Error("Lead not found");

  const profile = await profileWithAI({
    business_name: lead.business_name,
    website_url: lead.website_url,
    address: lead.address,
    country_code: lead.country_code,
    category: lead.category,
  });
  const createdAt = new Date().toISOString();

  const { patch, filled } = contactFill(lead, profile);
  if (Object.keys(patch).length) {
    const { error: e } = await db.from("leads").update(patch).eq("id", leadId);
    if (e) throw new Error(e.message);
  }
  let saved = true;
  const { error: pErr } = await db.from("leads").update({ ai_profile: profile, ai_profile_at: createdAt }).eq("id", leadId);
  if (pErr) {
    saved = false;
    if (!isMissingColumn(pErr, "ai_profile") && !isMissingColumn(pErr, "ai_profile_at")) log.warn({ lead_id: leadId, err: pErr.message }, "ai_profile.save_failed");
  }
  if (profile.sources.length) {
    const { error: nErr } = await db.from("lead_notes").insert({ lead_id: leadId, body: profileNote(profile), author: "AI profile" });
    if (nErr) log.warn({ lead_id: leadId, err: nErr.message }, "ai_profile.note_failed");
  }
  log.info({ lead_id: leadId, filled, saved, sources: profile.sources.length, usd: profile.usd }, "ai_profile.done");
  return { profile, createdAt, filled, saved };
}

/** The last saved profile, or null (none yet, or migration 061 not applied). Free. */
export async function loadAiProfile(leadId: string): Promise<{ profile: AiProfile; createdAt: string } | null> {
  const { data, error } = await getDb().from("leads").select("ai_profile,ai_profile_at").eq("id", leadId).maybeSingle();
  if (error) return null;
  const row = data as { ai_profile: AiProfile | null; ai_profile_at: string | null } | null;
  return row?.ai_profile && row.ai_profile_at ? { profile: row.ai_profile, createdAt: row.ai_profile_at } : null;
}
