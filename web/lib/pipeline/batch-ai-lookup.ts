/**
 * batch-ai-lookup.ts — scraping runs the full AI Lookup on each qualified lead (20 Nov 2026), in place of the old
 * contacts-only search: same cost (one OpenAI web search, ~2–5 cents), same per-batch cap.
 *
 * Inputs:  an AI Lookup result (lib/services/openai-profile.ts)
 * Outputs: the contact fields the scraping step fills (as before: email, phone, contact page, owner) + the whole result
 *          kept on the lead row (leads.ai_profile / ai_profile_at), so the research panel and the "Google vs AI
 *          Lookup" box are ready without a click. Pure.
 * Used by: lib/pipeline/stage-1-scrape.ts (enrichment → lib/pipeline/contact-research.ts)
 *
 * The AI's website is never applied here: it shows in the box and the operator Verifies it (lib/leads/google-vs-ai.ts).
 */
import type { AiContacts } from "../services/openai-contacts";
import type { AiProfile } from "../services/openai-profile";

export function contactsFromProfile(p: AiProfile): AiContacts {
  return {
    email: p.emails[0] ?? null,
    phone: p.phones[0] ?? null,
    contact_url: p.contact_url,
    owner_name: p.owner_name,
    owner_role: p.owner_name ? p.owner_role : null,
    sources: p.sources,
    usd: p.usd,
  };
}

export function keepProfileOnRow(row: Record<string, unknown>, p: AiProfile, at: string): void {
  row.ai_profile = { ...p, decisions: {} };
  row.ai_profile_at = at;
}
