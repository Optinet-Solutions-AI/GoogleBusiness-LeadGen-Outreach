/**
 * geo-check.ts — which country an address is in, and whether a lead sits outside its batch's country.
 *
 * Inputs:  a Google-Maps style address ("…, 70126 Bari BA, Italy" / "…, Houston, TX 77043") + ISO country code
 * Outputs: addressCountry() → ISO code or null (unknown); isWrongCountryLead() → boolean
 * Used by: lib/suppression.ts (no outreach to wrong-country leads), lib/pipeline/build-gate.ts,
 *          lib/pipeline/stage-1-scrape.ts, scripts/flag-wrong-country.ts
 *
 * Why: a batch for Italy returned US shops ("Rome" → Rome, GA). The scraper is now pinned to the country,
 * but this check works from the saved address alone, so it guards every lead whatever scraped it.
 * Conservative: null (unknown) never blocks.
 */
import { COUNTRIES } from "./data/cities";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Country names as Google prints them at the end of an address (English + local spellings). */
const NAMES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of COUNTRIES) m[fold(c.label)] = c.code;
  Object.assign(m, {
    italia: "it", espana: "es", deutschland: "de", osterreich: "at", austria: "at", schweiz: "ch", switzerland: "ch",
    suisse: "ch", mexico: "mx", brasil: "br", polska: "pl", sverige: "se", norge: "no", nederland: "nl",
    uk: "gb", england: "gb", scotland: "gb", wales: "gb", "northern ireland": "gb", belgium: "be", belgique: "be",
    usa: "us", "united states of america": "us", "united states": "us",
  });
  return m;
})();

/** US street format: "…, City, ST 12345" or "…, ST 12345-6789". */
const US_TAIL = /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/;

/** The ISO country an address names, or null when it can't tell. Pure. */
export function addressCountry(address: string | null | undefined): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  const last = fold(a.split(",").pop() ?? "");
  if (NAMES[last]) return NAMES[last];
  if (US_TAIL.test(a)) return "us";
  return null;
}

/** True when the lead's address is clearly in another country than its batch. Unknown → false. Pure. */
export function isWrongCountryLead(lead: { address?: string | null; country_code?: string | null }): boolean {
  const want = (lead.country_code ?? "").trim().toLowerCase();
  if (!want) return false;
  const got = addressCountry(lead.address);
  return got !== null && got !== want;
}
