/**
 * leads/ai-profile.ts — "AI Lookup" on a lead: OpenAI web search + a free scan of their own website.
 *
 * Inputs:  lead id
 * Outputs: runAiProfile → the findings + which empty contact fields it filled; saves leads.ai_profile /
 *          ai_profile_at (migration 061, keeps earlier Verify / Remove decisions for details found again), fills
 *          email / phone / owner / contact page only where the lead has none (never overwrites), merges
 *          contact_sources, and adds a CRM timeline note (lead_notes). loadAiProfile → the last saved result (free).
 * Used by: app/api/leads/[id]/ai-profile/route.ts (lead page "AI Lookup" + Leads list research buttons)
 *
 * Replaces "Find contacts (AI)" (15 Nov 2026): the same two sources (OpenAI first, their own site's email wins),
 * now run side by side. If OpenAI is unavailable the site scan still runs and `aiNote` says so.
 * Paid: one OpenAI web search, about 2–5 cents. Tolerates migrations 061 / 054 not applied.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isMissingColumn } from "@/lib/db-errors";
import { lookupSeenAt, profileWithAI, type AiProfile } from "@/lib/services/openai-profile";
import { findWebsiteContacts, type WebsiteContacts } from "@/lib/services/website-email";
import { verificationResetFor } from "@/lib/verify/email-change";
import { profileNote } from "./ai-profile-view";
import { reviewRows, type ResearchView } from "./research-review";

const log = getLogger("ai-profile");

export interface AiProfileResult {
  profile: ResearchView & { usd: number };
  createdAt: string;
  /** Contact fields this run added to the lead, in words ("email", "owner", …). */
  filled: string[];
  /** False when migration 061 isn't applied: shown now, not kept for next time. */
  saved: boolean;
  /** Set when OpenAI couldn't run (only their website was scanned). */
  aiNote: string | null;
}

type Row = {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  website_url: string | null;
  has_website: boolean | null;
  signal_type: string | null;
  signal_meta?: Record<string, unknown> | null;
  email: string | null;
  phone: string | null;
  contact_page_url: string | null;
  contact_owner_name: string | null;
  contact_owner_role: string | null;
  contact_sources: string[] | null;
  ai_profile: ResearchView | null;
};

const EMPTY: AiProfile = {
  summary: null, what_they_do: null, owner_name: null, owner_role: null, people: [], emails: [], phones: [],
  website: null, contact_url: null, address: null, hours: null, socials: [], services: [], founded: null,
  size: null, reviews: null, sources: [], usd: 0,
};

/** Fold the site scan into the AI findings: their own site's email comes first, nothing duplicated. Pure. */
export function mergeSiteScan(p: AiProfile, site: WebsiteContacts | null, siteUrl: string | null): AiProfile {
  if (!site || (!site.email && !site.phone && !site.contact_url)) return p;
  const emails = site.email ? [site.email, ...p.emails.filter((e) => e.toLowerCase() !== site.email!.toLowerCase())] : p.emails;
  const digits = (s: string) => s.replace(/\D/g, "").slice(-9);
  const phones = site.phone && !p.phones.some((x) => digits(x) === digits(site.phone!)) ? [...p.phones, site.phone] : p.phones;
  return {
    ...p,
    emails: emails.slice(0, 5),
    ...(site.email ? { email_notes: { [site.email.toLowerCase()]: "On their own website", ...(p.email_notes ?? {}) } } : {}),
    phones: phones.slice(0, 4),
    contact_url: p.contact_url ?? site.contact_url,
    website: p.website ?? siteUrl,
    sources: siteUrl && !p.sources.includes(siteUrl) ? [...p.sources, siteUrl] : p.sources,
  };
}

/** Which empty contact fields the findings can fill. Pure. Never overwrites what the lead already has. */
export function contactFill(lead: Omit<Row, "ai_profile" | "has_website" | "signal_type">, p: AiProfile): { patch: Record<string, unknown>; filled: string[] } {
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

/** Earlier Verify / Remove choices carry over for details found again. Pure. */
export function carryDecisions(prev: ResearchView | null, next: AiProfile): ResearchView["decisions"] {
  const old = prev?.decisions ?? {};
  if (!Object.keys(old).length) return {};
  const blank = { email: null, phone: null, contact_owner_name: null, contact_page_url: null };
  const keys = new Set(reviewRows({ ...next, decisions: {} }, blank).map((r) => r.key));
  return Object.fromEntries(Object.entries(old).filter(([k]) => keys.has(k)));
}

const COLS =
  "id,business_name,address,country_code,category,website_url,has_website,signal_type,email,phone,contact_page_url," +
  "contact_owner_name,contact_owner_role,contact_sources,signal_meta";

async function loadLead(leadId: string): Promise<Row> {
  const db = getDb();
  const withProfile = await db.from("leads").select(`${COLS},ai_profile`).eq("id", leadId).maybeSingle();
  let data = withProfile.data as unknown;
  if (withProfile.error) {
    if (!isMissingColumn(withProfile.error, "ai_profile")) throw new Error(withProfile.error.message);
    const plain = await db.from("leads").select(COLS).eq("id", leadId).maybeSingle();
    if (plain.error) throw new Error(plain.error.message);
    data = plain.data ? { ...(plain.data as object), ai_profile: null } : null;
  }
  if (!data) throw new Error("Lead not found");
  return data as Row;
}

export async function runAiProfile(leadId: string): Promise<AiProfileResult> {
  const db = getDb();
  const lead = await loadLead(leadId);
  const siteUrl =
    lead.website_url && (lead.has_website || lead.signal_type === "exhibitor" || lead.signal_type === "review_site") ? lead.website_url : null;

  const [ai, site] = await Promise.allSettled([
    profileWithAI({
      business_name: lead.business_name,
      website_url: lead.website_url,
      address: lead.address,
      country_code: lead.country_code,
      category: lead.category,
      seen_at: lookupSeenAt(lead.signal_type, lead.signal_meta),
    }),
    siteUrl ? findWebsiteContacts(siteUrl, lead.country_code ?? "us", { render: false }) : Promise.resolve(null),
  ]);
  let aiNote: string | null = null;
  if (ai.status === "rejected") {
    const msg = String(ai.reason instanceof Error ? ai.reason.message : ai.reason);
    aiNote = /OPENAI_API_KEY missing/.test(msg)
      ? "AI research is off (no OpenAI key), so only their website was checked."
      : "The AI search didn't work this time, so only their website was checked. Try again in a minute.";
    log.warn({ lead_id: leadId, err: msg }, "ai_profile.ai_failed");
    if (site.status !== "fulfilled" || !site.value) throw new Error(aiNote.replace(", so only their website was checked", ""));
  }
  const found = mergeSiteScan(ai.status === "fulfilled" ? ai.value : EMPTY, site.status === "fulfilled" ? site.value : null, siteUrl);
  const profile = { ...found, decisions: carryDecisions(lead.ai_profile, found) };
  const createdAt = new Date().toISOString();

  const { patch, filled } = contactFill(lead, found);
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
  if (found.sources.length) {
    const { error: nErr } = await db.from("lead_notes").insert({ lead_id: leadId, body: profileNote(found), author: "AI Lookup" });
    if (nErr) log.warn({ lead_id: leadId, err: nErr.message }, "ai_profile.note_failed");
  }
  log.info({ lead_id: leadId, filled, saved, ai: ai.status, sources: found.sources.length, usd: found.usd }, "ai_profile.done");
  return { profile, createdAt, filled, saved, aiNote };
}

/** The last saved result, or null (none yet, or migration 061 not applied). Free. */
export async function loadAiProfile(leadId: string): Promise<{ profile: ResearchView; createdAt: string } | null> {
  const { data, error } = await getDb().from("leads").select("ai_profile,ai_profile_at").eq("id", leadId).maybeSingle();
  if (error) return null;
  const row = data as { ai_profile: ResearchView | null; ai_profile_at: string | null } | null;
  return row?.ai_profile && row.ai_profile_at ? { profile: row.ai_profile, createdAt: row.ai_profile_at } : null;
}
