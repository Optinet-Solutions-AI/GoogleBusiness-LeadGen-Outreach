/**
 * format.ts — Tiny formatting helpers shared across template components.
 */

export function telHref(phone: string | null | undefined): string {
  if (!phone) return "#";
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function cityFromAddress(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2].split(" ")[0] : "";
}

/**
 * Best-effort "City, ST" extraction from a full street address. Falls back
 * to bare city when the state token isn't recognizable, and to null when
 * we have no address at all.
 *
 * Why this exists: bare city names with double meanings (most notably
 * "Mobile" for Mobile, Alabama) read as adjectives without the state
 * suffix. "Crafted for Mobile" looked like marketing-speak for "mobile
 * device"; "Crafted for Mobile, AL" reads unambiguously as a location.
 * The headline can also be paired with a MapPin icon for extra
 * clarity — but the state code alone gets us most of the way.
 *
 * Examples:
 *   "3660 Russells Ln, Mobile, AL 36619"  → "Mobile, AL"
 *   "101 Colombo St, Frankton, Hamilton 3204" → "Frankton"   (no US-style state)
 *   "Suite 4, Sydney, NSW 2000, Australia" → "Sydney, NSW"
 *   null / ""                              → null
 */
export function headlineLocation(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Walk from the END looking for a 2-letter or 2-3-letter state-ish
  // token (US "AL", Canadian "ON", Aus "NSW"). The city sits one
  // earlier; the optional postcode is folded into the state token by
  // splitting on whitespace and taking the first chunk.
  for (let i = parts.length - 1; i >= 1; i--) {
    const state = parts[i].split(/\s+/)[0];
    if (/^[A-Z]{2,3}$/.test(state)) {
      const city = parts[i - 1].split(/\s+/).slice(0, 3).join(" ").trim();
      if (city) return `${city}, ${state}`;
    }
  }
  // No state token found — return bare city.
  const city = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return city.split(/\s+/).slice(0, 3).join(" ").trim() || null;
}
