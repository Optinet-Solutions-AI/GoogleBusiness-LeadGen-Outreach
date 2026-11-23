/**
 * email/wording-test.ts — the rules of a wording test: two versions of one offer's email, taking turns (24 Nov 2026).
 *
 * Inputs:  wording-test rows (table email_tests, migration 066), send counts per version, what the operator picked
 * Outputs: nextVariant(sentA, sentB) · armKey(test, variant) · testForOffer(tests, offer) · startTestRefusal(...) ·
 *          startingEmail(offer, tests, winners) (what Send email fills)
 * Used by: lib/email/email-tests.ts, lib/email/email-used.ts, components/outreach/useEmailCompose.ts,
 *          components/templates/EmailResults.tsx
 *
 * Version A = the email used now for the offer (its ready-made email, or a saved template); version B = a saved
 * template. While a test runs, Send email for that offer fills whichever version has fewer sends (half and half).
 * The operator ends it and keeps A or B (operator decision, 24 Nov 2026: no automatic winner). Email keys:
 * "service:<offer>" (a ready-made email) or "saved:<template id>". Pure, safe in client components.
 */

export type Variant = "A" | "B";

export interface WordingTest {
  id: string;
  service_key: string;
  a_key: string;
  b_key: string;
  a_label: string;
  b_label: string;
  status: "running" | "done";
  winner: Variant | null;
  started_at: string;
  ended_at: string | null;
}

/** Sends each version needs before the numbers mean much. */
export const ENOUGH_SENDS = 30;

/** Whichever version has fewer sends goes next (A on a tie): half and half, taking turns. */
export function nextVariant(sentA: number, sentB: number): Variant {
  return sentA <= sentB ? "A" : "B";
}

export function armKey(t: Pick<WordingTest, "a_key" | "b_key">, v: Variant): string {
  return v === "A" ? t.a_key : t.b_key;
}

/** The running test for this offer, or null. */
export function testForOffer<T extends Pick<WordingTest, "service_key" | "status">>(tests: T[], offer: string): T | null {
  return tests.find((t) => t.status === "running" && t.service_key === offer) ?? null;
}

/** A plain sentence when this test can't start, or null when it can. */
export function startTestRefusal(
  input: { service_key: string; a_key: string; b_key: string },
  running: Pick<WordingTest, "service_key" | "status">[],
  templates: { id: string; archived: boolean }[],
): string | null {
  if (!input.service_key || input.service_key === "custom") return "Pick the offer to test.";
  if (!input.b_key.startsWith("saved:")) return "Version B must be a saved template. Write it on this page first.";
  if (input.a_key === input.b_key) return "Pick two different emails.";
  const usable = (key: string) => {
    const id = key.slice("saved:".length);
    return templates.some((t) => t.id === id && !t.archived);
  };
  for (const key of [input.a_key, input.b_key]) {
    if (key.startsWith("saved:") && !usable(key)) return "That saved template can't be used (it was deleted or archived).";
  }
  if (input.a_key.startsWith("service:") && input.a_key !== `service:${input.service_key}`) return "Version A's ready-made email is for a different offer.";
  if (!input.a_key.startsWith("service:") && !input.a_key.startsWith("saved:")) return "Pick version A.";
  if (testForOffer(running, input.service_key)) return "This offer already has a wording test running. End it first.";
  return null;
}

/** A running test as the Send email window sees it. */
export interface WindowTest {
  id: string;
  serviceKey: string;
  next: Variant;
  aKey: string;
  bKey: string;
}

/**
 * The email Send email fills when an offer is picked: a running test's version whose turn it is, else the saved
 * template that won the offer's last test, else the offer's ready-made email.
 */
export function startingEmail(
  offer: string,
  tests: WindowTest[],
  winners: Record<string, string>,
): { key: string; test: { id: string; variant: Variant } | null } {
  const t = tests.find((x) => x.serviceKey === offer);
  if (t) return { key: t.next === "A" ? t.aKey : t.bKey, test: { id: t.id, variant: t.next } };
  if (winners[offer]) return { key: winners[offer], test: null };
  return { key: `service:${offer}`, test: null };
}
