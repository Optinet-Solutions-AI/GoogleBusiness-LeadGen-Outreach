/**
 * grounding.ts — pure caption grounding check: every factual claim must exist in the client's Brand Brain.
 *
 * Inputs:  generated copy + template inputs, the model's claims_used citations, BrandProfileData, product snapshots
 * Outputs: Grounding { ok, issues[] } (unconfirmed-only matches are warnings and keep ok true)
 * Used by: creative copy pipeline (version creation / edits), approval gating
 *
 * Notes: "%" and "$" are claim keywords enforced via the price/percent pattern floor only (a grounded price or
 * percent needs no citation). claims.forbidden / voice.dont are never evidence and are blocked in copy.
 *        Years are grounded from every fact except business.contact.* (phone/address/email/website). Object-valued
 *        list items are cited as the item (audiences[0]) or .value.name. Citations must point at ONE fact (leaf), never a group. Keywords fail closed: "feel free" and
 *        "not only" are flagged too (the copy prompt tells the model to avoid those phrasings).
 */
import { normalizeForMatch } from "@/lib/clients/facts";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import type { ClaimUse, CreativeCopy, CreativeInputs, Grounding, Platform } from "./types";

export const CLAIM_KEYWORDS = [
  "guarantee", "certified", "award", "best", "#1", "only", "cheapest", "free", "%", "$", "since", "years",
  "licensed", "insured", "24/7", "same-day", "family-owned", "locally",
] as const;

export type PatternKind = "price" | "percent" | "year" | "phone" | "keyword";
export type Pattern = { kind: PatternKind; text: string };

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const PRICE_RE = new RegExp(String.raw`\$\s?(${NUM})|(?<![\d.,])(${NUM})\s?(?:dollars?|usd|bucks)\b`, "gi");
const PERCENT_RE = new RegExp(String.raw`(?<![\d.,])(${NUM})\s?(?:%|percent\b)`, "gi");
const YEAR_RE = /(?<![\d.,$])(?:19|20)\d{2}(?![\d]|[.,]\d)/g;
const PHONE_RE = /(?<![\d$])\+?\d[\d\s().-]{5,}\d(?!\d)/g;

/** Keyword-matching normal form: entity-decoded, lowercase, every hyphen variant becomes a space. */
const kn = (s: string): string =>
  normalizeForMatch(s)
    .replace(/[‐-―−]/g, "-")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");

// Whole-word keyword regexes over kn() text; spelling variants included (family owned, no. 1, 24-7 ...).
const KEYWORD_SPECS: [string, string][] = [
  ["guarantee", "guarantee(?:s|d|ing)?"],
  ["certified", "certif(?:y|ied|ies|ication|ications)"],
  ["award", "award(?:s|ed|ing)?"],
  ["best", "best"],
  ["#1", String.raw`#1|no\.? ?1|number (?:one|1)`],
  ["only", "only"],
  ["cheapest", "cheapest"],
  ["free", "free"],
  ["since", "since"],
  ["years", "years"],
  ["licensed", "licen[cs]ed"],
  ["insured", "insured"],
  ["24/7", String.raw`24(?: ?[/x] ?| )7`],
  ["same-day", "same day"],
  ["family-owned", "family owned"],
  ["locally", "locally"],
];
const KEYWORD_RES = KEYWORD_SPECS.map(([k, alt]) => ({
  k,
  re: new RegExp(String.raw`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, "i"),
}));

const digitsOnly = (s: string) => s.replace(/\D/g, "");
const phoneKey = (s: string) => digitsOnly(s).slice(-10);
const numNorm = (s: string) => s.replace(/,(?=\d{3}(?!\d))/g, "").replace(/\.0+$/, "");
const YEAR_RANGE_RE = /^(?:19|20)\d{2}\s?-\s?(?:19|20)\d{2}$/;

export function extractPatterns(text: string): Pattern[] {
  const out: Pattern[] = [];
  for (const m of text.matchAll(PRICE_RE)) out.push({ kind: "price", text: m[0].trim() });
  for (const m of text.matchAll(PERCENT_RE)) out.push({ kind: "percent", text: m[0].trim() });
  for (const m of text.matchAll(YEAR_RE)) out.push({ kind: "year", text: m[0] });
  for (const m of text.matchAll(PHONE_RE)) {
    if (YEAR_RANGE_RE.test(m[0].trim())) continue;
    if (digitsOnly(m[0]).length >= 7 && /[\s().+-]/.test(m[0])) out.push({ kind: "phone", text: m[0].trim() });
  }
  const k = kn(text);
  for (const { k: name, re } of KEYWORD_RES) if (re.test(k)) out.push({ kind: "keyword", text: name });
  return out;
}

type Obj = Record<string, unknown>;

function leafStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) leafStrings(x, out);
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v as Obj)) if (k !== "source" && k !== "confirmed") leafStrings(x, out);
  }
}

const hasUnconfirmed = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(hasUnconfirmed);
  if (typeof v !== "object" || v === null) return false;
  if ((v as Obj).confirmed === false) return true;
  return Object.values(v as Obj).some(hasUnconfirmed);
};

const isFact = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "value" in v && "confirmed" in v;

/** Bare product prices ("12.95") become "$12.95" so they count as price tokens. */
const asPrice = (s: string) => (/^\s*\d[\d.,]*\s*$/.test(s) ? `$${s.trim()}` : s);

/** Normalised fact text. claims.forbidden and voice.dont are deliberately excluded: never evidence. */
export function factCorpus(
  profile: BrandProfileData,
  products: ProductSnapshot[],
  includeContact = true,
): { confirmed: string[]; unconfirmed: string[] } {
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== "object" || v === null) return;
    if (isFact(v)) {
      leafStrings((v as Obj).value, (v as Obj).confirmed === true ? confirmed : unconfirmed);
      return;
    }
    for (const x of Object.values(v as Obj)) walk(x);
  };
  const { dont: _dont, ...voice } = profile.voice;
  void _dont;
  const { contact: _contact, ...businessRest } = profile.business;
  void _contact;
  walk({
    business: includeContact ? profile.business : businessRest,
    voice,
    audiences: profile.audiences,
    claims: { allowed: profile.claims.allowed },
    ctas: profile.ctas,
    social: profile.social,
  });
  for (const p of products) {
    const bucket = p.confirmed ? confirmed : unconfirmed;
    for (const s of [p.name, p.description, p.category]) if (s) bucket.push(s);
    if (p.price) bucket.push(asPrice(p.price));
  }
  const norm = (a: string[]) => a.map(normalizeForMatch).filter(Boolean);
  return { confirmed: norm(confirmed), unconfirmed: norm(unconfirmed) };
}

const BAD = new Set(["__proto__", "constructor", "prototype"]);
const FORBIDDEN_PATH = /^(?:claims\.forbidden|voice\.dont)(?:\[|\.|$)/;

/** Text at a dotted/[n] path, or a product id; `leaf` is false for groups/lists. Never throws. */
function textAtPath(
  path: string,
  profile: BrandProfileData,
  products: ProductSnapshot[],
): { text: string; unconfirmed: boolean; leaf: boolean } {
  const strs: string[] = [];
  const byId = products.find((p) => p.id !== undefined && p.id === path);
  if (byId) {
    leafStrings([byId.name, byId.description, byId.price, byId.category], strs);
    return { text: strs.join(" \n "), unconfirmed: !byId.confirmed, leaf: true };
  }
  const none = { text: "", unconfirmed: false, leaf: true };
  if (path.endsWith("[]")) return { ...none, leaf: false };
  let cur: unknown = { ...profile, products };
  let prodUnconfirmed = false;
  let productItem = false;
  for (const part of path.split(".")) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m || BAD.has(m[1]) || m[1] === "forbidden" || m[1] === "dont") return none;
    if (m[1] === "length") return { ...none, leaf: false };
    if (typeof cur !== "object" || cur === null) return none;
    cur = (cur as Obj)[m[1]];
    productItem = false;
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return none;
      cur = cur[Number(idx[1])];
      if (m[1] === "products" && typeof cur === "object" && cur !== null) {
        prodUnconfirmed = (cur as Obj).confirmed === false;
        productItem = true;
      }
    }
  }
  if (cur === undefined || cur === null) return none;
  const leaf = typeof cur === "string" || typeof cur === "number" || isFact(cur) || productItem;
  if (!leaf) return { ...none, leaf: false };
  leafStrings(cur, strs);
  return { text: strs.join(" \n "), unconfirmed: prodUnconfirmed || hasUnconfirmed(cur), leaf: true };
}

type TextSlot = { platform: Platform | "inputs"; text: string; review?: boolean };

const splitSentences = (t: string) => t.split(/(?<=[.!?])\s+(?!\d)|\n+/).filter((s) => s.trim());
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const wholeToken = (hay: string, needle: string) =>
  new RegExp(String.raw`(?<![a-z0-9])${escRe(needle)}(?![a-z0-9])`).test(hay);
const trimEdges = (s: string) => s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
const wordCount = (s: string) => s.split(" ").filter(Boolean).length;

/** Per-kind normalised number tokens found in a corpus bucket. */
function tokenSets(bucket: string[], yearBucket: string[]): Record<"price" | "percent" | "year" | "phone", Set<string>> {
  const sets = { price: new Set<string>(), percent: new Set<string>(), year: new Set<string>(), phone: new Set<string>() };
  for (const b of bucket) {
    for (const m of b.matchAll(PRICE_RE)) sets.price.add(numNorm(m[1] ?? m[2]));
    for (const m of b.matchAll(PERCENT_RE)) sets.percent.add(numNorm(m[1]));
    for (const m of b.matchAll(PHONE_RE)) {
      if (!YEAR_RANGE_RE.test(m[0].trim()) && digitsOnly(m[0]).length >= 7) sets.phone.add(phoneKey(m[0]));
    }
  }
  // years never come from business.contact.* (phones, street numbers, urls)
  for (const b of yearBucket) for (const m of b.matchAll(YEAR_RE)) sets.year.add(m[0]);
  return sets;
}

function tokenKey(kind: PatternKind, text: string): string {
  const t = normalizeForMatch(text);
  if (kind === "phone") return phoneKey(t);
  if (kind === "year") return t;
  return numNorm(/\d+(?:[.,]\d+)*/.exec(t)?.[0] ?? t);
}

export function checkGrounding(input: {
  copy: CreativeCopy;
  inputs: CreativeInputs;
  claimsUsed: ClaimUse[];
  profile: BrandProfileData;
  products: ProductSnapshot[];
  reviewText?: string | null;
  reviewAuthor?: string | null;
}): Grounding {
  const { copy, inputs, claimsUsed, profile, products, reviewText, reviewAuthor } = input;
  const issues: Grounding["issues"] = [];
  const corpus = factCorpus(profile, products);
  const yearCorpus = factCorpus(profile, products, false);
  const confirmedSets = tokenSets(corpus.confirmed, yearCorpus.confirmed);
  const unconfirmedSets = tokenSets(corpus.unconfirmed, yearCorpus.unconfirmed);
  const add = (platform: TextSlot["platform"], text: string, reason: string, warning?: boolean) => {
    if (issues.some((i) => i.platform === platform && i.text === text && i.reason === reason)) return;
    issues.push(warning ? { platform, text, reason, warning: true } : { platform, text, reason });
  };
  const isReview = Boolean(reviewText);

  // (b) cite-and-verify; only verified, non-forbidden citations can cover a keyword
  const validCites: string[] = [];
  for (const c of claimsUsed) {
    if (FORBIDDEN_PATH.test(c.path)) {
      add("inputs", c.text, "cited path is a forbidden claim");
      continue;
    }
    const at = textAtPath(c.path, profile, products);
    if (!at.leaf) {
      add("inputs", c.text, "cited path must point at one fact");
      continue;
    }
    const needle = kn(c.text);
    if (!needle || !kn(at.text).includes(needle)) {
      add("inputs", c.text, "cited path does not contain this text");
      continue;
    }
    validCites.push(kn(c.text));
    if (at.unconfirmed) add("inputs", c.text, "matches an unconfirmed fact", true);
  }

  const slots: TextSlot[] = [];
  for (const [pl, pc] of Object.entries(copy) as [Platform, { caption: string } | undefined][]) {
    if (pc) slots.push({ platform: pl, text: pc.caption });
  }
  slots.push({ platform: "inputs", text: inputs.headline });
  slots.push({ platform: "inputs", text: inputs.subhead, review: isReview && reviewAuthor !== undefined });
  slots.push({ platform: "inputs", text: inputs.cta_text });
  if (inputs.body) slots.push({ platform: "inputs", text: inputs.body, review: isReview });
  for (const s of inputs.slides ?? []) {
    slots.push({ platform: "inputs", text: s.headline }, { platform: "inputs", text: s.subhead });
  }

  const forbidden = [
    ...profile.claims.forbidden.map((f) => f.value),
    ...profile.voice.dont.map((f) => f.value),
  ]
    .map(kn)
    .filter((v) => v.length >= 3);

  const year = new Date().getFullYear();
  for (const { platform, text, review } of slots) {
    if (review) continue; // the verbatim review quote/author are verified below instead
    const kt = kn(text);
    for (const f of forbidden) if (wholeToken(kt, f)) add(platform, f, "contains a forbidden claim");

    for (const sentence of splitSentences(text)) {
      const ks0 = kn(sentence);
      const citedYears = new Set<string>();
      for (const c of validCites) if (ks0.includes(c)) for (const m of c.matchAll(YEAR_RE)) citedYears.add(m[0]);
      for (const p of extractPatterns(sentence)) {
        if (p.kind === "keyword") continue;
        const key = tokenKey(p.kind, p.text);
        if (p.kind === "year" && (key === String(year) || key === String(year + 1) || citedYears.has(key))) continue;
        if (confirmedSets[p.kind].has(key)) continue;
        if (unconfirmedSets[p.kind].has(key)) add(platform, p.text, "matches an unconfirmed fact", true);
        else add(platform, p.text, "not in brand brain");
      }
    }

    for (const sentence of splitSentences(text)) {
      const ks = kn(sentence);
      for (const { k, re } of KEYWORD_RES) {
        if (!re.test(ks)) continue;
        const covered = validCites.some(
          (c) => c.length >= 3 && ks.includes(c) && (re.test(c) || ((k === "since" || k === "years") && /\d/.test(c))),
        );
        if (!covered) add(platform, sentence.trim(), "unsupported claim keyword without citation");
      }
    }
  }

  // review template: quote (body) verbatim at word boundaries, author line (subhead) exact
  if (reviewText) {
    const review = trimEdges(kn(reviewText));
    const quote = trimEdges(kn(inputs.body ?? ""));
    const okQuote =
      quote.length > 0 &&
      wholeToken(review, quote) &&
      (wordCount(quote) >= 4 || (wordCount(review) < 4 && quote === review));
    if (!okQuote) add("inputs", inputs.body ?? "", "review quote does not match");
    if (reviewAuthor !== undefined && kn(inputs.subhead) !== kn(reviewAuthor ?? "")) {
      add("inputs", inputs.subhead, "review author does not match");
    }
  }

  return { ok: !issues.some((i) => !i.warning), issues };
}
