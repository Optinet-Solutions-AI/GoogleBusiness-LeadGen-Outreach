/**
 * google.ts — build a link to a lead's Google Business Profile (Maps listing).
 *
 * Inputs:  place_id (preferred — links to the exact listing) and, as a fallback,
 *          business_name + address/city for a Maps search.
 * Outputs: a maps.google.com URL, or null when we have nothing to link to.
 *
 * Note: synthetic demo leads (scripts/showcase-niches.ts) have no place_id and
 * a fabricated name/address, so the fallback search resolves to nothing — that
 * is expected, not a bug. Real scraped leads always carry a place_id.
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
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
