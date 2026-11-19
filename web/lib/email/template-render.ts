/**
 * email/template-render.ts — fill a saved email template's {{tokens}} for one lead (19 Nov 2026). Pure (runs in the
 * Send email window and on the Templates page).
 *
 * Inputs:  template text (subject / body / follow-up) + the lead's values
 * Outputs: the filled text — a line that held only empty tokens (e.g. {{demo_link}} with no demo site) is dropped,
 *          blank-line runs collapse; unknown tokens are left visible and listed by unknownTokens() for a warning
 * Used by: components/outreach/SimpleEmailModal.tsx, components/templates/TemplatesClient.tsx
 */

export const TEMPLATE_TOKENS = [
  "business",
  "first_name",
  "city",
  "category",
  "demo_link",
  "site",
  "rating",
  "reviews",
  "event",
  "booth",
  "sender",
] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];
export type TemplateVars = Partial<Record<TemplateToken, string | number | null>>;

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_TOKENS);

const filled = (v: string | number | null | undefined): string => (v == null ? "" : String(v).trim());

export function renderTemplate(text: string, vars: TemplateVars): string {
  const lines = text.split("\n").map((line) => {
    let hadToken = false;
    let allEmpty = true;
    const out = line.replace(TOKEN_RE, (whole, name: string) => {
      if (!KNOWN.has(name)) return whole;
      hadToken = true;
      const v = filled(vars[name as TemplateToken]);
      if (v) allEmpty = false;
      return v;
    });
    // A line that only carried empty tokens (plus spaces / punctuation) disappears instead of leaving "Link: ".
    const leftover = out.replace(/[\s:.,;\-–—()]/g, "");
    return hadToken && allEmpty && leftover.length === 0 ? null : out;
  });
  return lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Tokens in the text that aren't ours (typos) — shown as a warning, never filled. */
export function unknownTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const name = m[1];
    if (!KNOWN.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Every {{placeholder}} still left in the texts (a typo, or one that wasn't filled) — sending is blocked while any remain. */
export function leftoverTokens(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(TOKEN_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Does the template mention this placeholder anywhere (e.g. {{demo_link}})? */
export function usesToken(texts: string[], token: TemplateToken): boolean {
  return texts.some((t) => [...t.matchAll(TOKEN_RE)].some((m) => m[1] === token));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "Save as template" from Send email: turn this lead's own details back into placeholders ("Acme Diner" →
 * {{business}}), so the saved template works for any lead. Only clear matches: the owner's name only in the greeting
 * ("Hi Joe,"), the sender's only on a sign-off line of its own, the category in any case (built-in emails lowercase
 * it), never inside a longer word or domain, never numbers or values shorter than 3 characters. Longest values first.
 */
export function tokenize(text: string, vars: TemplateVars): string {
  const pairs = (Object.entries(vars) as [TemplateToken, string | number | null | undefined][])
    .map(([k, v]) => [k, filled(v)] as const)
    .filter(([k, v]) => v.length >= 3 && !/^[\d\s.,:-]+$/.test(v) && !(k === "first_name" && v.toLowerCase() === "there"))
    .sort((a, b) => b[1].length - a[1].length);
  let out = text;
  for (const [k, v] of pairs) {
    const val = escapeRe(v);
    if (k === "first_name") {
      out = out.replace(new RegExp(`^(\\s*(?:hi|hello|hey|dear)\\s+)${val}(?![\\w])`, "gim"), `$1{{${k}}}`);
    } else if (k === "sender") {
      out = out.replace(new RegExp(`^(\\s*)${val}(\\s*)$`, "gm"), `$1{{${k}}}$2`);
    } else {
      out = out.replace(new RegExp(`(?<![\\w])${val}(?![\\w])`, k === "category" ? "gi" : "g"), `{{${k}}}`);
    }
  }
  return out;
}

const firstWord = (s: string | null | undefined): string | null => (s ?? "").trim().split(/\s+/)[0] || null;

export function varsForLead(c: {
  businessName: string;
  ownerName?: string | null;
  city?: string | null;
  category?: string | null;
  demoUrl?: string | null;
  platform?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  eventName?: string | null;
  booth?: string | null;
  senderName?: string | null;
}): TemplateVars {
  return {
    business: c.businessName.trim(),
    first_name: firstWord(c.ownerName) ?? "there",
    city: (c.city ?? "").split(",")[0].trim() || null,
    category: c.category?.trim() || null,
    demo_link: c.demoUrl?.trim() || null,
    site: c.platform?.trim() || null,
    rating: typeof c.rating === "number" && c.rating > 0 ? `${c.rating}★` : null,
    reviews: typeof c.reviewCount === "number" && c.reviewCount > 0 ? `${c.reviewCount} reviews` : null,
    event: c.eventName?.trim() || null,
    booth: c.booth?.trim() || null,
    sender: firstWord(c.senderName),
  };
}
