/**
 * test-mode-rules.ts — Test mode: while it's on, nothing is sent to an email, phone or contact page that isn't on the
 * test list (operator, 26 Nov 2026: "safeguards so QA won't make a mistake"). Pure.
 *
 * Inputs:  the setting (on / off + the allowed emails, phones and website hosts) and one address to check
 * Outputs: allowEmail / allowPhone / allowUrl (true = may be sent to), the plain refusal text, parseTestMode
 * Used by: lib/test-mode.ts (loads the setting), every send point (email-sender, contact-form runs, call scheduler,
 *          quick calls, mobivate, batch email, brain approve), the dashboard banner
 *
 * Fail-closed: a setting that can't be read is ON with empty lists, which blocks every send. Only the operator turns it
 * off (by asking: web/scripts/test-mode.ts); the app has no switch for it.
 */

export interface TestMode {
  on: boolean;
  emails: string[];
  phones: string[];
  /** Website hosts whose contact forms may be filled (e.g. the app itself, for /test-form). */
  hosts: string[];
}

/** What is used when the setting can't be read: everything blocked. */
export const CLOSED: TestMode = { on: true, emails: [], phones: [], hosts: [] };

export const TEST_MODE_TEXT =
  "Test mode is on: the app only sends to test contacts (the test list), never to real businesses. Nothing was sent. Ask Chris to add this contact to the test list, or to switch to live.";

const cleanEmail = (e: string) => e.trim().toLowerCase();
/** The last 10 digits: "+1 (512) 555-0123", "5125550123" and "+15125550123" are the same number. */
const phoneKey = (p: string) => p.replace(/\D/g, "").slice(-10);
const cleanHost = (h: string) => h.trim().toLowerCase().replace(/^www\./, "");

function hostOf(url: string): string | null {
  try {
    return cleanHost(new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname);
  } catch {
    return null;
  }
}

/** The stored JSON as a TestMode; anything unreadable → CLOSED (fail-closed). `on` is false only when it says so. */
export function parseTestMode(raw: unknown): TestMode {
  if (!raw || typeof raw !== "object") return CLOSED;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  return {
    on: r.on !== false,
    emails: list(r.emails).map(cleanEmail),
    phones: list(r.phones).filter((p) => phoneKey(p).length >= 7),
    hosts: list(r.hosts).map(cleanHost),
  };
}

export function allowEmail(m: TestMode, email: string | null | undefined): boolean {
  if (!m.on) return true;
  return !!email && m.emails.includes(cleanEmail(email));
}

export function allowPhone(m: TestMode, phone: string | null | undefined): boolean {
  if (!m.on) return true;
  const k = phone ? phoneKey(phone) : "";
  return k.length >= 7 && m.phones.some((p) => phoneKey(p) === k);
}

/** A contact page / website: its host must be on the list (www. ignored). */
export function allowUrl(m: TestMode, url: string | null | undefined): boolean {
  if (!m.on) return true;
  const h = url ? hostOf(url) : null;
  return !!h && m.hosts.includes(h);
}
