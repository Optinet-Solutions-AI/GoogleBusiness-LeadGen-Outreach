/**
 * phone.ts — format a scraped lead phone as one E.164 number (+<country><national>).
 *
 * Inputs:  the raw lead phone ("(512) 555-0100", "+64 9 123 4567", "09 123 4567") + country_code
 * Outputs: "+15125550100" or null when it can't be made into one confident number
 * Used by: lib/pipeline/call-scheduler.ts (Voizo needs E.164; a list or a guess is refused)
 *
 * Pure. A leading "+" is trusted as-is. Otherwise a 10-digit "(xxx) xxx-xxxx" is NANP (+1) —
 * Google Maps formats US/CA numbers that way even on leads tagged with another country — and
 * any other national number gets the lead country's calling code with its trunk "0" dropped.
 */

/** Calling codes for the countries we scrape (lib/data/cities.ts). */
const CALLING_CODE: Record<string, string> = {
  us: "1", ca: "1", mx: "52", br: "55", ar: "54", cl: "56", co: "57", pe: "51",
  gb: "44", ie: "353", de: "49", fr: "33", es: "34", it: "39", pt: "351", nl: "31",
  se: "46", no: "47", pl: "48", gr: "30",
  au: "61", nz: "64", fj: "679",
  ph: "63", id: "62", th: "66", vn: "84", my: "60", sg: "65", in: "91", jp: "81",
  kr: "82", tw: "886", hk: "852",
  ae: "971", sa: "966", il: "972", jo: "962", za: "27",
};

const NANP_FORMAT = /^\(\d{3}\)\s?\d{3}-\d{4}$/;

export function toE164(raw: string | null | undefined, countryCode?: string | null): string | null {
  const phone = (raw ?? "").trim();
  if (!phone || /[,;\n/]/.test(phone)) return null; // empty, or a list of numbers
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (phone.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (phone.startsWith("00")) {
    e164 = `+${digits.slice(2)}`;
  } else if (NANP_FORMAT.test(phone) || (digits.length === 11 && digits.startsWith("1") && isNanp(countryCode))) {
    e164 = `+1${digits.slice(-10)}`;
  } else {
    const cc = CALLING_CODE[(countryCode ?? "").toLowerCase()];
    if (!cc) return null;
    if (cc === "1" && digits.length === 10) e164 = `+1${digits}`;
    else e164 = `+${cc}${digits.replace(/^0+/, "")}`;
  }

  // E.164: up to 15 digits; anything under 8 is not a real subscriber number.
  const len = e164.length - 1;
  return len >= 8 && len <= 15 ? e164 : null;
}

function isNanp(countryCode?: string | null): boolean {
  const c = (countryCode ?? "").toLowerCase();
  return c === "us" || c === "ca";
}
