/**
 * grounding.ts — pure caption grounding check: every factual claim must exist in the client's Brand Brain.
 *
 * Inputs:  generated copy + template inputs, the model's claims_used citations, BrandProfileData, product snapshots
 * Outputs: Grounding { ok, issues[] } (unconfirmed-only matches are warnings and keep ok true)
 * Used by: creative copy pipeline (version creation / edits), approval gating
 *
 * Notes: "%" and "$" are claim keywords enforced via the price/percent pattern floor only (a grounded price or
 * percent needs no citation). claims.forbidden / voice.dont are never evidence and are blocked in copy.
 *        Years are grounded from every fact except business.contact.* (phone/address/email/website); a citation into
 *        business.contact.* never grounds a year or covers since/years. since/years are covered only by a citation
 *        holding a year or "N years"/"N yrs". Object-valued
 *        list items are cited as the item (audiences[0]) or .value.name. Citations must point at ONE fact (leaf), never a group. Keywords fail closed: "feel free" and
 *        "not only" are flagged too (the copy prompt tells the model to avoid those phrasings).
 */
import { normalizeForMatch } from "@/lib/clients/facts";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import { CTA_LABELS, type ClaimUse, type CreativeCopy, type CreativeInputs, type Grounding, type Platform } from "./types";

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
const CONTACT_PATH = /^business\.contact(?:\[|\.|$)/;
const YEAR_ONE_RE = new RegExp(YEAR_RE.source);
const N_YEARS_RE = /(?<![a-z0-9.,])\d+(?:[.,]\d+)?\+? ?(?:years?|yrs?)(?![a-z0-9])/;

/** The numeric value of a number or purely numeric string leaf ("18.5", "$17.50"), else undefined. */
function numericLeaf(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !/^\s*\$?\s?\d[\d.,]*\s*$/.test(v)) return undefined;
  const n = Number(numNorm(v.replace(/[$\s]/g, "")));
  return Number.isFinite(n) ? n : undefined;
}

/** True when the claim text contains a number equal to `n` ("price 18.5", "$18.50"; not "price 19"). */
const claimHasNumber = (text: string, n: number): boolean =>
  (normalizeForMatch(text).match(new RegExp(NUM, "g")) ?? []).some((m) => Number(numNorm(m)) === n);

const CTA_LABEL_SET = new Set(Object.values(CTA_LABELS).map((l) => l.toLowerCase()));

/** Text at a dotted/[n] path, or a product id; `leaf` is false for groups/lists. Never throws. */
function textAtPath(
  path: string,
  profile: BrandProfileData,
  products: ProductSnapshot[],
): { text: string; unconfirmed: boolean; leaf: boolean; num?: number } {
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
  const num = numericLeaf(isFact(cur) ? (cur as Obj).value : cur);
  return {
    text: strs.join(" \n "),
    unconfirmed: prodUnconfirmed || hasUnconfirmed(cur),
    leaf: true,
    ...(num === undefined ? {} : { num }),
  };
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

  // (b) cite-and-verify; only verified, non-forbidden citations can cover a keyword.
  // `contact` marks business.contact.* citations: they never ground a year or cover since/years.
  const validCites: { text: string; contact: boolean }[] = [];
  for (const c of claimsUsed) {
    if (CTA_LABEL_SET.has(c.text.trim().toLowerCase())) continue; // a button label is not a claim
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
    // by value only when the claim adds no claim keyword ("since 1971" must still match the fact text)
    const byValue =
      at.num !== undefined &&
      claimHasNumber(c.text, at.num) &&
      !extractPatterns(c.text).some((p) => p.kind === "keyword");
    if (!needle || (!byValue && !kn(at.text).includes(needle))) {
      add("inputs", c.text, "cited path does not contain this text");
      continue;
    }
    validCites.push({ text: needle, contact: CONTACT_PATH.test(c.path) });
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
      for (const c of validCites) {
        if (!c.contact && ks0.includes(c.text)) for (const m of c.text.matchAll(YEAR_RE)) citedYears.add(m[0]);
      }
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
        const sinceYears = k === "since" || k === "years";
        const covered = validCites.some(
          ({ text: c, contact }) =>
            c.length >= 3 &&
            ks.includes(c) &&
            (sinceYears ? !contact && (YEAR_ONE_RE.test(c) || N_YEARS_RE.test(c)) : re.test(c)),
        );
        if (!covered) add(platform, sentence.trim(), "unsupported claim keyword without citation");
      }
    }
  }

  // hashtags: camel-case words are scanned like caption text (forbidden values + keyword floor, covered by a verified citation)
  for (const [pl, pc] of Object.entries(copy) as [Platform, { hashtags: string[] } | undefined][]) {
    for (const tag of pc?.hashtags ?? []) {
      const words = kn(
        tag
          .replace(/^#/, "")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
          .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, "$1$3 $2$4")
          .replace(/_/g, " "),
      );
      if (!words) continue;
      for (const f of forbidden) if (wholeToken(words, f)) add(pl, tag, "contains a forbidden claim");
      for (const { k, re } of KEYWORD_RES) {
        if (!re.test(words)) continue;
        const sinceYears = k === "since" || k === "years";
        const covered = validCites.some(
          ({ text: c, contact }) =>
            c.length >= 3 && (sinceYears ? !contact && (YEAR_ONE_RE.test(c) || N_YEARS_RE.test(c)) : re.test(c)),
        );
        if (!covered) add(pl, tag, "unsupported claim keyword without citation");
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
