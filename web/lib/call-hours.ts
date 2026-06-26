/**
 * call-hours.ts — Campaign timezone helper. Pure, no I/O.
 *
 * Inputs:  a country code string
 * Outputs: campaignTimezone() maps a country to a representative IANA tz
 * Used by: lib/campaigns (scheduling SMS/email/DM sends in the prospect's timezone)
 *
 * Representative-tz-per-country is an approximation (large countries span zones) —
 * fine for the single-country pilot. Unknown code → UTC.
 */

/** Lowercase ISO-3166 alpha-2 → representative IANA timezone. Covers every
 *  country in lib/data/cities COUNTRIES (a representative zone per country —
 *  large countries span zones; fine for campaign scheduling). Unknown → UTC. */
const COUNTRY_TZ: Record<string, string> = {
  // North America
  us: "America/New_York", ca: "America/Toronto", mx: "America/Mexico_City",
  // South America
  br: "America/Sao_Paulo", ar: "America/Argentina/Buenos_Aires", cl: "America/Santiago",
  co: "America/Bogota", pe: "America/Lima",
  // Europe
  gb: "Europe/London", ie: "Europe/Dublin", de: "Europe/Berlin", fr: "Europe/Paris",
  es: "Europe/Madrid", it: "Europe/Rome", pt: "Europe/Lisbon", nl: "Europe/Amsterdam",
  se: "Europe/Stockholm", no: "Europe/Oslo", pl: "Europe/Warsaw", gr: "Europe/Athens",
  // Oceania
  au: "Australia/Sydney", nz: "Pacific/Auckland", fj: "Pacific/Fiji",
  // Asia
  ph: "Asia/Manila", id: "Asia/Jakarta", th: "Asia/Bangkok", vn: "Asia/Ho_Chi_Minh",
  my: "Asia/Kuala_Lumpur", sg: "Asia/Singapore", in: "Asia/Kolkata", jp: "Asia/Tokyo",
  kr: "Asia/Seoul", tw: "Asia/Taipei", hk: "Asia/Hong_Kong",
  // Middle East
  ae: "Asia/Dubai", sa: "Asia/Riyadh", il: "Asia/Jerusalem", jo: "Asia/Amman",
  // Africa
  za: "Africa/Johannesburg", ng: "Africa/Lagos", ke: "Africa/Nairobi", eg: "Africa/Cairo",
  ma: "Africa/Casablanca", gh: "Africa/Accra",
  // Caribbean
  jm: "America/Jamaica", tt: "America/Port_of_Spain", do: "America/Santo_Domingo",
};

export function campaignTimezone(countryCode: string | null | undefined): string {
  if (!countryCode) return "UTC";
  return COUNTRY_TZ[countryCode.trim().toLowerCase()] ?? "UTC";
}
