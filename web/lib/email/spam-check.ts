/**
 * spam-check.ts — Heuristic spam-risk + "looks-AI" detector for outbound copy.
 *
 * Inputs:  subject + html of a rendered email (post-spintax)
 * Outputs: { score, level, flags } — flags name each problem found
 * Used by: sequence-scheduler.ts (logs a warning before sending), tests
 *
 * Pure + deterministic. No I/O, no model calls. Catches the cheap, obvious
 * deliverability killers (spam trigger words, ALL-CAPS, link/!! pile-ups,
 * money amounts) plus the em/en dash that screams "written by AI".
 */

export type SpamLevel = "low" | "medium" | "high";

export interface SpamResult {
  score: number;
  level: SpamLevel;
  flags: string[];
}

// Classic cold-email spam-filter trigger phrases (lowercased, matched as substrings).
const SPAM_PHRASES = [
  "free", "100% free", "risk-free", "no obligation", "no cost", "no catch",
  "guarantee", "guaranteed", "act now", "limited time", "limited offer",
  "click here", "click below", "buy now", "order now", "sign up free",
  "cash", "earn money", "make money", "extra income", "double your",
  "winner", "you have won", "congratulations", "urgent", "important information",
  "this is not spam", "amazing", "incredible deal", "best price", "lowest price",
  "cheap", "discount", "% off", "save big", "credit card", "increase sales",
  "boost your", "miracle", "satisfaction", "dear friend", "dear sir",
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function spamCheck(subject: string, html: string): SpamResult {
  const flags: string[] = [];
  const raw = `${subject} ${html}`;
  const text = `${subject} ${stripHtml(html)}`;
  const lower = text.toLowerCase();

  // 1. Em / en dash — AI tell + some filters dislike it.
  if (/[—–]/.test(text) || /&mdash;|&ndash;/.test(raw)) {
    flags.push("em/en dash (reads as AI-written)");
  }

  // 2. Spam trigger phrases.
  for (const p of SPAM_PHRASES) {
    if (lower.includes(p)) flags.push(`spam phrase: "${p}"`);
  }

  // 3. ALL-CAPS shouting (5+ consecutive caps, ignores common acronyms).
  const caps = text.match(/\b[A-Z]{5,}\b/g);
  if (caps && caps.length) flags.push(`ALL-CAPS word(s): ${caps.slice(0, 3).join(", ")}`);

  // 4. Exclamation pile-up.
  const bangs = (text.match(/!/g) || []).length;
  if (bangs > 1) flags.push(`${bangs} exclamation marks`);
  if (/[!?]{2,}/.test(text)) flags.push("repeated punctuation (!! / ??)");

  // 5. Too many links.
  const links = (html.match(/href=/gi) || []).length;
  if (links > 2) flags.push(`${links} links`);

  // 6. Money amounts.
  if (/[$£€]\s?\d/.test(text)) flags.push("money amount");

  const score = flags.length;
  const level: SpamLevel = score === 0 ? "low" : score <= 2 ? "medium" : "high";
  return { score, level, flags };
}
