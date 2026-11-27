/**
 * test-mode-rules.ts — Test mode: while it's on, nothing is sent to an email, phone or contact page that isn't on the
 * test list (operator, 26 Nov 2026: "safeguards so QA won't make a mistake"). Pure.
 *
 * Inputs:  the setting (on / off + the allowed emails, phones and website hosts) and one address to check
 * Outputs: allowEmail / allowPhone / allowUrl (true = may be sent to), the plain refusal text, parseTestMode,
 *          addContact / removeContact (QA edits the test list: emails and phones only; never on / off, never hosts),
 *          withHistory / testPeriods / inTestPeriod (when it was on: lib/analytics/cost-per-reply.ts leaves it out)
 * Used by: lib/test-mode.ts (loads the setting), every send point (email-sender, contact-form runs, call scheduler,
 *          quick calls, mobivate, batch email, brain approve), the dashboard banner
 *
 * Fail-closed: a setting that can't be read is ON with empty lists, which blocks every send. Only the operator turns it
 * off (by asking: web/scripts/test-mode.ts); the app has no switch for it. QA adds their own email / phone on the Test
 * list page (operator, 26 Nov 2026).
 */

export interface TestMode {
  on: boolean;
  emails: string[];
  phones: string[];
  /** Website hosts whose contact forms may be filled (e.g. the app itself, for /test-form). */
  hosts: string[];
  /** When Test mode was switched on / off (27 Nov 2026; absent = on since TEST_MODE_SINCE, never switched). */
  history?: TestSwitch[];
}

export interface TestSwitch {
  on: boolean;
  at: string;
}

/** Test mode started with migration 075; activity before this was real. */
export const TEST_MODE_SINCE = "2026-11-26T00:00:00.000Z";
const HISTORY_MAX = 200;

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
  const history = Array.isArray(r.history)
    ? r.history.filter((h): h is TestSwitch => !!h && typeof h === "object" && typeof (h as TestSwitch).on === "boolean" && typeof (h as TestSwitch).at === "string" && Number.isFinite(Date.parse((h as TestSwitch).at)))
    : null;
  return {
    on: r.on !== false,
    emails: list(r.emails).map(cleanEmail),
    phones: list(r.phones).filter((p) => phoneKey(p).length >= 7),
    hosts: list(r.hosts).map(cleanHost),
    ...(history ? { history: history.map((h) => ({ on: h.on, at: h.at })) } : {}),
  };
}

/** The setting to save: `next`, keeping `prev`'s history, plus one entry when on / off changed. */
export function withHistory(prev: TestMode, next: TestMode, now: Date): TestMode {
  const history = [...(prev.history ?? [])];
  if (prev.on !== next.on) history.push({ on: next.on, at: now.toISOString() });
  const { history: _drop, ...rest } = next;
  void _drop;
  return history.length ? { ...rest, history: history.slice(-HISTORY_MAX) } : rest;
}

/** When Test mode was on, oldest first: from TEST_MODE_SINCE, opened / closed by each switch, the last one open until now. */
export function testPeriods(m: TestMode, now: Date): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const switches = [...(m.history ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Before the first switch it was on (075 started it on), unless the first switch turned it on.
  let openFrom: string | null = switches[0]?.on === true ? null : TEST_MODE_SINCE;
  for (const s of switches) {
    const at = new Date(s.at).toISOString();
    if (s.on && openFrom === null) openFrom = at;
    else if (!s.on && openFrom !== null) {
      out.push({ from: openFrom, to: at });
      openFrom = null;
    }
  }
  if (openFrom !== null && m.on) out.push({ from: openFrom, to: now.toISOString() });
  return out;
}

export function inTestPeriod(at: string, periods: { from: string; to: string }[]): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && periods.some((p) => t >= Date.parse(p.from) && t < Date.parse(p.to));
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

export type ContactKind = "email" | "phone";
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** A phone number with its country code ("+1 512 555 0123"): "+" and 8–15 digits, kept as +digits. */
function cleanPhone(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("+")) return null;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && /^[+\d\s().-]+$/.test(t) ? `+${digits}` : null;
}

/** Add a test email / phone. Test mode's on / off and the website list are never changed here. */
export function addContact(m: TestMode, kind: ContactKind, raw: string): { ok: true; mode: TestMode } | { ok: false; message: string } {
  if (kind === "email") {
    const e = cleanEmail(raw);
    if (!EMAIL_RX.test(e)) return { ok: false, message: "That doesn't look like an email address." };
    if (m.emails.includes(e)) return { ok: false, message: "That email is already on the test list." };
    return { ok: true, mode: { ...m, emails: [...m.emails, e] } };
  }
  const p = cleanPhone(raw);
  if (!p) return { ok: false, message: "Type the full number with its country code, starting with + (e.g. +63 917 123 4567)." };
  if (m.phones.some((x) => phoneKey(x) === phoneKey(p))) return { ok: false, message: "That number is already on the test list." };
  return { ok: true, mode: { ...m, phones: [...m.phones, p] } };
}

/** Remove a test email / phone (anything else is left as it is). */
export function removeContact(m: TestMode, kind: ContactKind, raw: string): TestMode {
  if (kind === "email") return { ...m, emails: m.emails.filter((e) => e !== cleanEmail(raw)) };
  const k = phoneKey(raw);
  return { ...m, phones: m.phones.filter((p) => phoneKey(p) !== k) };
}
