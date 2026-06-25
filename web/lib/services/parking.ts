/**
 * parking.ts — Detect parked / for-sale domains so we never treat a domain
 *              parking page as the business's real website.
 *
 * Inputs:  a URL (host check) and/or fetched HTML + final (post-redirect) URL
 * Outputs: booleans — isParkingHost(url), looksParked(html, finalUrl)
 * Used by: lib/services/website-brand.ts, lib/services/logo.ts
 *
 * Why: a business's domain often expires and resolves to a parking page
 * (HugeDomains, Sedo, Dan, etc.). Scraping it yields the PARKING SERVICE's logo
 * and copy (e.g. the "HugeDomains" wordmark), not the business's. We reject
 * those so the lead falls back to its monogram and is treated as having no real
 * site. Pure functions, no I/O.
 */

/** Known domain-parking / for-sale marketplaces. A logo or final URL on one of
 *  these hosts is the parking service's, never the business's. */
const PARKING_HOSTS = [
  "hugedomains.com",
  "sedo.com",
  "sedoparking.com",
  "dan.com",
  "afternic.com",
  "bodis.com",
  "parkingcrew.net",
  "parklogic.com",
  "above.com",
  "domainmarket.com",
  "undeveloped.com",
  "fabulous.com",
  "uniregistry.com",
  "domain.com",
];

/** Phrases specific to domain-parking / for-sale pages. Deliberately NOT bare
 *  "for sale" (a real business may sell things) — these only fire on language
 *  used by parking landers. */
const PARKING_MARKERS = [
  "this domain is for sale",
  "this domain name is for sale",
  "buy this domain",
  "the domain may be for sale",
  "domain may be for sale",
  "is for sale | hugedomains",
  "hugedomains",
  "sedoparking",
  "domain_profile.cfm",
  "the owner of this domain",
  "interested in this domain",
  "domain parking",
  "checkout the full domain details",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

/** Is this URL hosted on a known domain-parking marketplace? */
export function isParkingHost(url: string | null | undefined): boolean {
  if (!url) return false;
  const host = hostOf(url);
  if (!host) return false;
  return PARKING_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
}

/** Does this page (its final URL or HTML) look like a parked / for-sale domain? */
export function looksParked(html: string | null | undefined, finalUrl?: string | null): boolean {
  if (finalUrl && isParkingHost(finalUrl)) return true;
  if (!html) return false;
  const hay = html.toLowerCase();
  // "<domain> is for sale" with any registrar/marketplace named alongside.
  if (/\bis for sale\b/.test(hay) && /(hugedomains|sedo|godaddy|afternic|dan\.com|domain)/.test(hay)) {
    return true;
  }
  return PARKING_MARKERS.some((m) => hay.includes(m));
}
