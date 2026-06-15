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

/** Lowercase ISO-3166 alpha-2 → representative IANA timezone. Extend as needed. */
const COUNTRY_TZ: Record<string, string> = {
  us: "America/New_York",
  ca: "America/Toronto",
  gb: "Europe/London",
  ie: "Europe/Dublin",
  au: "Australia/Sydney",
  nz: "Pacific/Auckland",
  ph: "Asia/Manila",
};

export function campaignTimezone(countryCode: string | null | undefined): string {
  if (!countryCode) return "UTC";
  return COUNTRY_TZ[countryCode.trim().toLowerCase()] ?? "UTC";
}
