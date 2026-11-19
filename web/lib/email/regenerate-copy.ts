/**
 * email/regenerate-copy.ts — "Regenerate" in Send email: rewrite the email with Gemini (19 Nov 2026).
 *
 * Inputs:  the current subject, body and follow-ups (plain text) in the window
 * Outputs: a fresh version with the same offer, facts, names, links and language — or a plain error. One Gemini call
 *          (free tier); nothing is sent. A rewrite that drops a link or uses spam words is refused, not shown.
 * Used by: app/api/leads/[id]/send-email/regenerate/route.ts
 */
import "@/lib/server-guard";
import { rewriteOutreachEmail } from "@/lib/services/gemini";

export interface Copy {
  subject: string;
  body: string;
  followUps: string[];
}

const SPAM = /\b(free|guarantee[sd]?|100%|risk[- ]free|act now|limited time)\b/i;
const URL_RE = /https?:\/\/[^\s)]+/g;
const noDashes = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

/** Use the rewrite only if it's complete, keeps every link of the original and avoids spam words. Pure. */
export function cleanRewrite(original: Copy, out: Copy | null | undefined): Copy | null {
  if (!out || typeof out.subject !== "string" || typeof out.body !== "string" || !out.subject.trim() || !out.body.trim()) return null;
  const all = (c: Copy) => [c.subject, c.body, ...(c.followUps ?? [])].join("\n");
  const links = original.body.match(URL_RE) ?? [];
  if (links.some((l) => !out.body.includes(l))) return null;
  if (SPAM.test(all(out)) && !SPAM.test(all(original))) return null;
  const followUps = original.followUps.map((f, i) => (f.trim() ? noDashes(String(out.followUps?.[i] ?? f).trim()) : ""));
  return { subject: noDashes(out.subject.trim()), body: noDashes(out.body.trim()), followUps };
}

export async function regenerateCopy(copy: Copy): Promise<{ copy: Copy } | { error: string }> {
  const out = await rewriteOutreachEmail(copy);
  if (!out) return { error: "Couldn't rewrite it right now (Gemini unavailable). Try again in a minute." };
  const clean = cleanRewrite(copy, out);
  if (!clean) return { error: "The rewrite dropped a link or used spam words, so it wasn't used. Press Regenerate again." };
  return { copy: clean };
}
