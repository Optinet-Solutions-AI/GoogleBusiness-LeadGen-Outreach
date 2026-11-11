/**
 * leads/research-contact.ts — "Find contacts (AI)" for one existing lead.
 *
 * Inputs:  lead id
 * Outputs: saves email (only if none), phone (only if none), contact_page_url, contact_owner_name/role,
 *          contact_sources on the lead; returns what was found + whether AI ran
 * Used by: app/api/leads/[id]/contacts/route.ts (lead page + leads-list buttons)
 *
 * Same order as a batch (lib/pipeline/contact-research.ts): OpenAI web search first, then the business's own site.
 * Paid: about 1–3 cents when AI runs. When OpenAI is unavailable it still crawls and says so in `ai_state`.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { newAiRun } from "@/lib/pipeline/ai-notices";
import { researchContacts } from "@/lib/pipeline/contact-research";
import { findContactsWithAI } from "@/lib/services/openai-contacts";
import { getOpenAiHealth, type OpenAiState } from "@/lib/services/openai-health";
import { findWebsiteContacts } from "@/lib/services/website-email";
import { OPENAI_REASON } from "@/lib/ai-status";

const log = getLogger("research-contact");

export interface ResearchOutcome {
  email: string | null;
  phone: string | null;
  contact_page_url: string | null;
  contact_owner_name: string | null;
  contact_owner_role: string | null;
  contact_sources: string[];
  /** Did a new email / phone / owner get added this run? */
  found: { email: boolean; phone: boolean; owner: boolean; contact_page: boolean };
  ai_state: OpenAiState;
  usd: number;
}

type Row = {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  has_website: boolean | null;
  signal_type: string | null;
  signal_meta: unknown;
  contact_page_url: string | null;
  contact_owner_name: string | null;
  contact_owner_role: string | null;
  contact_sources: string[] | null;
};

export async function researchLeadContacts(leadId: string): Promise<ResearchOutcome> {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("id,business_name,address,country_code,email,phone,website_url,has_website,signal_type,signal_meta,contact_page_url,contact_owner_name,contact_owner_role,contact_sources")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const lead = data as Row | null;
  if (!lead) throw new Error("Lead not found");

  const health = await getOpenAiHealth().catch(() => ({ state: "unreachable" as OpenAiState }));
  const ai = newAiRun(1);
  if (health.state !== "ok") ai.unavailable = health.state;

  const row: Record<string, unknown> = { ...lead };
  const isLiquidation = !!lead.signal_type && lead.signal_type !== "exhibitor";
  const ownSite = lead.website_url && (lead.has_website || lead.signal_type === "exhibitor") ? lead.website_url : null;
  await researchContacts(
    row,
    { aiEligible: !isLiquidation, ownSite, countryCode: lead.country_code ?? "us" },
    ai,
    { ai: findContactsWithAI, crawl: (url, cc) => findWebsiteContacts(url, cc, { render: false }) },
  );

  const patch: Record<string, unknown> = {};
  for (const k of ["email", "phone", "contact_page_url", "contact_owner_name", "contact_owner_role", "contact_sources"] as const) {
    if (row[k] !== lead[k] && row[k] != null) patch[k] = row[k];
  }
  if (Object.keys(patch).length) {
    const { error: uErr } = await db.from("leads").update(patch).eq("id", leadId);
    if (uErr) throw new Error(uErr.message);
  }
  const aiState: OpenAiState = ai.unavailable ?? ai.stoppedAt ?? "ok";
  log.info({ lead_id: leadId, patch: Object.keys(patch), ai_state: aiState, usd: ai.usd }, "research_contact.done");
  return {
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    contact_page_url: (row.contact_page_url as string | null) ?? null,
    contact_owner_name: (row.contact_owner_name as string | null) ?? null,
    contact_owner_role: (row.contact_owner_role as string | null) ?? null,
    contact_sources: (row.contact_sources as string[] | undefined) ?? [],
    found: {
      email: !lead.email && !!row.email,
      phone: !lead.phone && !!row.phone,
      owner: !lead.contact_owner_name && !!row.contact_owner_name,
      contact_page: !lead.contact_page_url && !!row.contact_page_url,
    },
    ai_state: aiState,
    usd: ai.usd,
  };
}

/** One sentence for the toast. Pure. */
export function describeOutcome(o: ResearchOutcome): string {
  const got: string[] = [];
  if (o.found.email) got.push(`email ${o.email}`);
  if (o.found.phone) got.push(`phone ${o.phone}`);
  if (o.found.owner) got.push(`contact ${o.contact_owner_name}${o.contact_owner_role ? ` (${o.contact_owner_role})` : ""}`);
  if (o.found.contact_page) got.push("their contact page");
  const aiNote = o.ai_state !== "ok" ? ` AI research was off (${OPENAI_REASON[o.ai_state]}), so only their website was checked.` : "";
  if (got.length) return `Found: ${got.join(", ")}.${aiNote}`;
  if (o.email || o.contact_owner_name) {
    return `Nothing new — what we have is confirmed (${o.contact_sources.length} source${o.contact_sources.length === 1 ? "" : "s"}).${aiNote}`;
  }
  return `No public contact details found for this business.${aiNote}`;
}
