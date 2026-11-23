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
 *    When the web address forwards to a different site (23 Nov 2026: a locksmith's address forwarded to its web
 *    partner's page, whose email and 404 contact link were saved), that site's details only fill gaps.
 * When OpenAI is unavailable the crawl still runs; the AiRun tally turns into a visible batch notice.
 */
import { getLogger } from "../logger";
import { OpenAiUnavailableError } from "../services/openai-health";
import type { AiContacts } from "../services/openai-contacts";
import type { AiRun } from "./ai-notices";

const log = getLogger("contact-research");

type SiteContacts = {
  email: string | null;
  phone: string | null;
  contact_url: string | null;
  /** The web address forwards to another site (its host): what was found there may not be the lead's own. */
  forwarded_to?: string | null;
};

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
  // Emails AI said reach a head office / agency, not this business: never the main email (local businesses).
  const notMain = new Set<string>();

  if (o.aiEligible && !ai.unavailable && !ai.stoppedAt) {
    if (ai.left <= 0) {
      ai.skippedByCap += 1;
    } else {
      ai.left -= 1;
      ai.used += 1;
      try {
        // A conference lead's show goes to the lookup as "Seen at" (stage-1's ai dep), not as a made-up address.
        const c = await deps.ai({
          business_name: String(row.business_name ?? ""),
          website_url: o.ownSite,
          address: (row.address as string | null) ?? null,
          country_code: country,
        });
        ai.usd += c.usd;
        for (const e of c.not_main ?? []) notMain.add(e.toLowerCase());
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
      // Their own site beats a directory. A web address that forwards to ANOTHER site (a web partner's page, a
      // parent company) proves nothing: what is there only fills a gap, it never replaces what AI found.
      const own = !c.forwarded_to;
      if (c.email && !scraperEmail && (own || !row.email) && !notMain.has(c.email.toLowerCase())) row.email = c.email;
      if (!row.phone && c.phone) row.phone = c.phone;
      if (c.contact_url && (own || !row.contact_page_url)) row.contact_page_url = c.contact_url;
      if (c.email) sources.unshift(c.contact_url ?? o.ownSite);
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "contact_research.crawl_failed");
    }
  }
  if (sources.length) row.contact_sources = [...new Set(sources)];
}
