/**
 * contact-research.ts — find a lead's contacts: AI research first, then the business's own website.
 *
 * Inputs:  a lead row being enriched (business_name, address, email, phone, website, country, signal_meta),
 *          the batch's AiRun tally, and the two lookups (injectable for tests)
 * Outputs: mutates the row: email, phone, contact_page_url, contact_owner_name/role, contact_sources;
 *          updates the AiRun tally (lookups, cost, why AI was off or stopped, leads past the cap)
 * Used by: lib/pipeline/stage-1-scrape.ts (enrichOne)
 *
 * 1) OpenAI web search (paid, ~1–3 cents a lead, capped per batch): business email, phone, contact page and the
 *    owner, each backed by a public page. Works for no-website leads too (listings, Facebook).
 * 2) The free crawl of the business's own site fills what AI missed and double-checks it: an email published on
 *    their own site wins over one AI found in a directory. What the scraper (Google) gave us is never overwritten.
 * When OpenAI is unavailable the crawl still runs; the AiRun tally turns into a visible batch notice.
 */
import { getLogger } from "../logger";
import { OpenAiUnavailableError } from "../services/openai-health";
import type { AiContacts } from "../services/openai-contacts";
import type { AiRun } from "./ai-notices";

const log = getLogger("contact-research");

type SiteContacts = { email: string | null; phone: string | null; contact_url: string | null };

export type ContactResearchDeps = {
  ai: (b: { business_name: string; website_url: string | null; address: string | null; country_code: string | null }) => Promise<AiContacts>;
  crawl: (url: string, countryCode: string | null) => Promise<SiteContacts>;
};

export async function researchContacts(
  row: Record<string, unknown>,
  o: { aiEligible: boolean; ownSite: string | null; countryCode: string },
  ai: AiRun,
  deps: ContactResearchDeps,
): Promise<void> {
  const scraperEmail = typeof row.email === "string" && row.email ? (row.email as string) : null;
  const country = (row.country_code as string | null) || o.countryCode;
  const sources: string[] = [];

  if (o.aiEligible && !ai.unavailable && !ai.stoppedAt) {
    if (ai.left <= 0) {
      ai.skippedByCap += 1;
    } else {
      ai.left -= 1;
      ai.used += 1;
      try {
        const meta = (row.signal_meta as { event_name?: string } | null) ?? null;
        const c = await deps.ai({
          business_name: String(row.business_name ?? ""),
          website_url: o.ownSite,
          address: (row.address as string | null) ?? (meta?.event_name ? `exhibitor at ${meta.event_name}` : null),
          country_code: country,
        });
        ai.usd += c.usd;
        if (!row.email && c.email) row.email = c.email;
        if (!row.phone && c.phone) row.phone = c.phone;
        if (c.contact_url) row.contact_page_url = c.contact_url;
        if (c.owner_name) {
          row.contact_owner_name = c.owner_name;
          row.contact_owner_role = c.owner_role;
        }
        sources.push(...c.sources);
      } catch (err) {
        // Key refused / out of credit: no more AI for this batch (the notice says so). Other errors skip one lead.
        if (err instanceof OpenAiUnavailableError) ai.stoppedAt = err.state;
        else if (/ 429/.test(String(err))) ai.stoppedAt = "unreachable";
        log.warn({ err: String(err).slice(0, 200) }, "contact_research.ai_failed");
      }
    }
  }

  if (o.ownSite) {
    try {
      const c = await deps.crawl(o.ownSite, country);
      if (c.email && !scraperEmail) row.email = c.email; // their own site beats a directory
      if (!row.phone && c.phone) row.phone = c.phone;
      if (c.contact_url) row.contact_page_url = c.contact_url;
      if (c.email) sources.unshift(c.contact_url ?? o.ownSite);
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "contact_research.crawl_failed");
    }
  }
  if (sources.length) row.contact_sources = [...new Set(sources)];
}
