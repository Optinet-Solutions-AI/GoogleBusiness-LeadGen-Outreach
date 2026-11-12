/**
 * calls/greeting-name.ts — the first name the Voizo AI agent greets a lead by. Pure.
 *
 * Inputs:  the lead's owner/contact name (e.g. "Dr. Robert Ellul"), or what the operator typed
 * Outputs: a safe first name ("Robert") or null (the agent then uses no name)
 * Used by: lib/calls/load-call-preview.ts (suggestion), lib/calls/quick-call.ts (saving), the call preview
 *
 * Voizo speaks this name in the greeting and drops anything a phone (SIP) header can't carry, so we keep it
 * to letters, spaces, apostrophes and hyphens, and never pass a role or a mailbox word as a name.
 */

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "madam", "mx", "rev", "fr", "eng", "ing"]);
const NOT_NAMES = new Set([
  "owner", "manager", "team", "the", "info", "office", "sales", "admin", "contact", "support", "hello",
  "reception", "customer", "service", "director", "ceo", "founder", "staff", "unknown", "n/a", "na",
]);

/** Clean what the operator typed. Empty / invalid → null (no name). */
export function cleanGreetingName(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = input.normalize("NFC").replace(/[^\p{L}\p{M}' -]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return t.length >= 2 ? t : null;
}

/** Suggest a greeting from the owner/contact name: the first real first name, else null. */
export function suggestGreetingName(owner: string | null | undefined): string | null {
  if (!owner) return null;
  const words = owner
    .split(/[\s,]+/)
    .map((w) => w.replace(/\.$/, ""))
    .filter(Boolean);
  for (const w of words) {
    const lower = w.toLowerCase();
    if (TITLES.has(lower)) continue;
    if (NOT_NAMES.has(lower)) return null;
    const clean = cleanGreetingName(w);
    if (!clean || clean.length < 2) return null;
    // Title-case shouting ("ROBERT" → "Robert"), keep mixed case as typed ("McDonald").
    return clean === clean.toUpperCase() ? clean[0] + clean.slice(1).toLowerCase() : clean;
  }
  return null;
}
