/**
 * google.ts — build a link to a lead's Google Business Profile (Maps listing).
 *
 * Inputs:  place_id (preferred — links to the exact listing) and, as a fallback,
 *          business_name + address/city for a plain Google web search.
 * Outputs: a google.com URL (Maps listing when we have a place_id, else a web
 *          search), or null when we have nothing to link to.
 *
 * Why the fallback is a web search, not a Maps search: without a place_id the
 * business may not resolve on Maps (e.g. demo/showcase leads), leaving an empty
 * map. A web search always surfaces something useful.
 * Used by: leads table, batch detail, lead detail — "click the name → Google".
 */
export function googleProfileUrl(lead: {
  place_id?: string | null;
  business_name?: string | null;
  address?: string | null;
  city?: string | null;
}): string | null {
  if (lead.place_id) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(lead.place_id)}`;
  }
  const query = [lead.business_name, lead.address ?? lead.city].filter(Boolean).join(" ").trim();
  if (!query) return null;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
