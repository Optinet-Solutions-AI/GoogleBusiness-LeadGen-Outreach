/**
 * grounding.ts — pure caption grounding check: every factual claim must exist in the client's Brand Brain.
 *
 * Inputs:  generated copy + template inputs, the model's claims_used citations, BrandProfileData, product snapshots
 * Outputs: Grounding { ok, issues[] } (unconfirmed-only matches are warnings and keep ok true)
 * Used by: creative copy pipeline (version creation / edits), approval gating
 *
 * Notes: ONE evidence allowlist (EVIDENCE_PATH for citations, factCorpus for the number floor): business identity,
 *        contact, description, hours, service areas, claims.allowed, products, CTA texts (the brand's own offers)
 *        and reviews. voice.*, audiences (pains/wants), style notes, hashtag seeds, social links and
 *        claims.forbidden are NEVER evidence - neither for citations nor for the price/percent/year/phone floor.
 *        "%" and "$" are claim keywords enforced via the price/percent pattern floor only (a grounded price or
 *        percent needs no citation). claims.forbidden / voice.dont are never evidence and are blocked in copy.
 *        A keyword is covered only by a verified citation that holds a content word besides the keyword and is
 *        contained (whole words) in the same caption sentence / hashtag; every occurrence must sit inside one.
 *        Hashtags (camel-case split) get the same price/percent/year/phone floor as captions.
 *        Years are grounded from every fact except business.contact.* (phone/address/email/website); a citation into
 *        business.contact.* never grounds a year or covers since/years. since/years are covered only by a citation
 *        holding a year or "N years"/"N yrs". Citations must point at ONE fact (leaf), never a group. Keywords fail
 *        closed: "feel free" and "not only" are flagged too (the copy prompt tells the model to avoid those phrasings).
 *        Review template: the quote is verbatim from a reviews[n].body, the author line is exactly its author, and a
 *        caption attribution ("— Jane D.", "Jane says") must name that author.
 */
import { normalizeForMatch } from "@/lib/clients/facts";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import { CTA_LABELS, type ClaimUse, type CreativeCopy, type CreativeInputs, type Grounding, type Platform } from "./types";

export const CLAIM_KEYWORDS = [
  "guarantee", "certified", "award", "best", "#1", "only", "cheapest", "free", "%", "$", "since", "years",
  "licensed", "insured", "24/7", "same-day", "family-owned", "locally",
  "lifetime", "forever", "always", "never", "guaranteed", "unlimited",
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
  ["lifetime", "lifetime"],
  ["forever", "forever"],
  ["always", "always"],
  ["never", "never"],
  ["unlimited", "unlimited"],
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

/**
 * Normalised fact text from the evidence allowlist only: business.*, claims.allowed, CTA texts, reviews, products.
 * voice.*, audiences, social, visuals and claims.forbidden are deliberately excluded: never evidence.
 */
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
  const { contact: _contact, ...businessRest } = profile.business;
  void _contact;
  walk({
    business: includeContact ? profile.business : businessRest,
    claims: { allowed: profile.claims.allowed },
    ctas: profile.ctas.map((c) => ({ ...c, value: c.value.text })),
    reviews: profile.reviews ?? [],
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
/** The only citable paths (Ruling 29). `ctas[n]` / `ctas[n].value` are read as `ctas[n].value.text`. */
const EVIDENCE_PATH = new RegExp(
  [
    String.raw`^business\.(?:name|tagline|description|category|founded)(?:\.value)?$`,
    String.raw`^business\.(?:languages|service_areas)\[\d+\](?:\.value)?$`,
    String.raw`^business\.contact\.(?:phone|email|address|website)(?:\.value)?$`,
    String.raw`^business\.hours\.(?:mon|tue|wed|thu|fri|sat|sun)(?:\.value)?$`,
    String.raw`^claims\.allowed\[\d+\](?:\.value)?$`,
    String.raw`^products\[\d+\](?:\.(?:name|description|price|category))?$`,
    String.raw`^ctas\[\d+\]\.value\.text$`,
    String.raw`^reviews\[\d+\](?:\.value(?:\.(?:body|author))?)?$`,
  ].join("|"),
);
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

/**
 * Text at a dotted/[n] path, or a product id; `leaf` is false for groups/lists; `evidence` is false for a path
 * outside the allowlist (voice, audiences, social ...). Never throws.
 */
function textAtPath(
  rawPath: string,
  profile: BrandProfileData,
  products: ProductSnapshot[],
): { text: string; unconfirmed: boolean; leaf: boolean; evidence: boolean; num?: number } {
  const strs: string[] = [];
  const byId = products.find((p) => p.id !== undefined && p.id === rawPath);
  if (byId) {
    leafStrings([byId.name, byId.description, byId.price, byId.category], strs);
    return { text: strs.join(" \n "), unconfirmed: !byId.confirmed, leaf: true, evidence: true };
  }
  const path = rawPath.replace(/^ctas\[(\d+)\](?:\.value)?$/, "ctas[$1].value.text");
  const evidence = EVIDENCE_PATH.test(path);
  const none = { text: "", unconfirmed: false, leaf: true, evidence };
  if (path.endsWith("[]")) return { ...none, leaf: false };
  let cur: unknown = { ...profile, products };
  let prodUnconfirmed = false;
  let productItem = false;
  let parentFact: unknown = null;
  for (const part of path.split(".")) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m || BAD.has(m[1]) || m[1] === "forbidden" || m[1] === "dont") return none;
    if (m[1] === "length") return { ...none, leaf: false };
    if (typeof cur !== "object" || cur === null) return none;
    if (isFact(cur)) parentFact = cur;
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
    unconfirmed: prodUnconfirmed || hasUnconfirmed(cur) || (parentFact as Obj | null)?.confirmed === false,
    leaf: true,
    evidence,
    ...(num === undefined ? {} : { num }),
  };
}

type TextSlot = { platform: Platform | "inputs"; text: string; review?: boolean };
type Cite = { text: string; contact: boolean };

const splitSentences = (t: string) => t.split(/(?<=[.!?])\s+(?!\d)|\n+/).filter((s) => s.trim());
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const tokenRe = (needle: string, flags = "") =>
  new RegExp(String.raw`(?<![a-z0-9])${escRe(needle)}(?![a-z0-9])`, flags);
const wholeToken = (hay: string, needle: string) => tokenRe(needle).test(hay);
const trimEdges = (s: string) => s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
const trimCite = (s: string) => s.replace(/^[\s.,;:!?"'()]+|[\s.,;:!?"'()]+$/g, "");
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

const STOPWORDS = new Set([
  "the", "and", "for", "our", "are", "with", "you", "your", "all", "any", "its", "was", "not", "but", "from",
  "this", "that", "has", "have", "who", "can", "get", "got", "just", "than", "then", "them", "they", "their",
  "there", "here", "more", "most", "very", "also", "too", "now", "every",
]);

/** True when the citation holds a content word besides the keyword: a bare "free" / "guarantee" covers nothing. */
function hasExtraWord(cite: string, re: RegExp): boolean {
  const rest = cite.replace(new RegExp(re.source, "gi"), " ");
  return rest.split(/[^a-z0-9]+/).some((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Keyword `k` in `hay` (one kn() sentence, or a split hashtag) is covered when every occurrence sits inside a
 * verified citation that is contained (whole words) in `hay`, contains the keyword and adds a content word.
 * since/years: a non-contact citation holding a year or "N years", contained in `hay`.
 */
function keywordCovered(hay: string, k: string, re: RegExp, cites: Cite[]): boolean {
  if (k === "since" || k === "years") {
    return cites.some(
      (c) =>
        !c.contact &&
        c.text.length >= 3 &&
        (YEAR_ONE_RE.test(c.text) || N_YEARS_RE.test(c.text)) &&
        wholeToken(hay, c.text),
    );
  }
  let masked = hay;
  for (const c of cites) {
    if (c.text.length < 3 || !re.test(c.text) || !hasExtraWord(c.text, re)) continue;
    masked = masked.replace(tokenRe(c.text, "g"), " ");
  }
  return masked !== hay && !re.test(masked);
}

/** A hashtag as kn() words: #SameDayService -> "same day service", #Est1985 -> "est 1985". */
function hashtagWords(tag: string): string {
  return kn(
    tag
      .replace(/^#/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])(?=\d)|(\d)(?=[A-Za-z])/g, "$1$2 ")
      .replace(/_/g, " "),
  );
}

const compact = (s: string) => s.replace(/[^a-z0-9]/g, "");
/** Claim keywords (those with a matcher) as run-together text, >= 4 chars: "same-day" -> "sameday". */
const RAW_KEYWORDS = KEYWORD_RES.map(({ k, re }) => ({ k, re, c: compact(k) })).filter((x) => x.c.length >= 4);

/** Number-unit runs inside an unsplit lowercase tag: "50percentoff", "49dollarsoff", "20pct", "30off", years. */
function rawTagPatterns(raw: string): Pattern[] {
  const out: Pattern[] = [];
  for (const m of raw.matchAll(/(?<![\d.,])(\d+(?:\.\d+)?)(?:%|percent|pct|off)/g)) out.push({ kind: "percent", text: m[1] + "%" });
  for (const m of raw.matchAll(/(?<![\d.,])(\d+(?:\.\d+)?)(?:dollars?|usd|bucks)/g)) out.push({ kind: "price", text: "$" + m[1] });
  for (const m of raw.matchAll(/\$(\d+(?:\.\d+)?)/g)) out.push({ kind: "price", text: "$" + m[1] });
  for (const m of raw.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)) out.push({ kind: "year", text: m[0] });
  return out;
}

/** A run-together keyword hit in a tag is covered when verified citations (run-together, with an extra word) mask every hit. */
function rawKeywordCovered(rawc: string, c: string, re: RegExp, cites: Cite[]): boolean {
  let masked = rawc;
  for (const ci of cites) {
    const cc = compact(ci.text);
    if (cc.length < 3 || !re.test(ci.text) || !hasExtraWord(ci.text, re) || !rawc.includes(cc)) continue;
    masked = masked.split(cc).join(" ");
  }
  return masked !== rawc && !masked.includes(c);
}

const NEGATOR_RE = /(?:^|[^a-z])(?:not|never|no|without)(?![a-z])|n['’]t(?![a-z])/;
/** True when every occurrence of `needle` in `text` has a negator within the 3 words just before it. */
function negatedEverywhere(text: string, needle: string): boolean {
  let from = 0;
  let seen = false;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) return seen;
    seen = true;
    const before = text.slice(0, i).trim().split(/\s+/).slice(-3).join(" ");
    if (!NEGATOR_RE.test(before)) return false;
    from = i + 1;
  }
}

const NAME = String.raw`\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,2}`;
/** Caption attributions: `"..." — Jane D.`, a line starting "— Jane", "says Jane", "Jane says". */
const ATTRIBUTION_RES = [
  new RegExp(String.raw`["”]\s*[—–~-]\s*(${NAME})`, "gu"),
  new RegExp(String.raw`^\s*[—–~]\s*(${NAME})`, "gmu"),
  new RegExp(String.raw`\b(?:says|said|writes|wrote|shared)\s+(${NAME})`, "gu"),
  new RegExp(String.raw`(${NAME})\s+(?:says|said|writes|wrote|shared)\b`, "gu"),
];
const GENERIC_ATTRIBUTION = new Set([
  "google", "review", "reviews", "reviewer", "verified", "customer", "customers", "client", "clients", "happy",
  "everyone", "homeowner", "neighbor", "neighbour", "one", "local", "five", "star", "as", "what", "facebook", "yelp",
]);

/** Named people in caption attributions that are not the review's author. */
function wrongAttributions(caption: string, author: string): string[] {
  const a = kn(author);
  const out: string[] = [];
  for (const re of ATTRIBUTION_RES) {
    for (const m of caption.matchAll(re)) {
      const words = kn(m[1])
        .split(/[^\p{L}0-9']+/u)
        .map((w) => w.replace(/'s$/, ""))
        .filter((w) => w.length >= 2 && !GENERIC_ATTRIBUTION.has(w) && !STOPWORDS.has(w));
      if (words.some((w) => !wholeToken(a, w))) out.push(m[1].trim());
    }
  }
  return out;
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

  // (b) cite-and-verify; only verified, non-forbidden, allowlisted citations can cover a keyword.
  // `contact` marks business.contact.* citations: they never ground a year or cover since/years.
  const validCites: Cite[] = [];
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
    if (!at.evidence) {
      add("inputs", c.text, "cited path is not a fact (voice, audiences and style notes are never evidence)");
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
    if (!byValue && negatedEverywhere(kn(at.text), needle)) {
      add("inputs", c.text, "cited text is negated in the fact");
      continue;
    }
    const text = trimCite(needle);
    if (text) validCites.push({ text, contact: CONTACT_PATH.test(c.path) });
    if (at.unconfirmed) add("inputs", c.text, "matches an unconfirmed fact", true);
  }

  const slots: TextSlot[] = [];
  for (const [pl, pc] of Object.entries(copy) as [Platform, { caption: string } | undefined][]) {
    if (pc) slots.push({ platform: pl, text: pc.caption });
  }
  slots.push({ platform: "inputs", text: inputs.headline });
  slots.push({ platform: "inputs", text: inputs.subhead, review: isReview });
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
  /** Price / percent / year / phone floor over one sentence or split hashtag; issues carry `label` when given. */
  const scanNumbers = (platform: TextSlot["platform"], text: string, label?: string, extra: Pattern[] = []) => {
    const ks0 = kn(text);
    const citedYears = new Set<string>();
    for (const c of validCites) {
      if (!c.contact && wholeToken(ks0, c.text)) for (const m of c.text.matchAll(YEAR_RE)) citedYears.add(m[0]);
    }
    for (const p of [...extractPatterns(text), ...extra]) {
      if (p.kind === "keyword") continue;
      const key = tokenKey(p.kind, p.text);
      if (p.kind === "year" && (key === String(year) || key === String(year + 1) || citedYears.has(key))) continue;
      if (confirmedSets[p.kind].has(key)) continue;
      if (unconfirmedSets[p.kind].has(key)) add(platform, label ?? p.text, "matches an unconfirmed fact", true);
      else add(platform, label ?? p.text, "not in brand brain");
    }
  };

  for (const { platform, text, review } of slots) {
    if (review) continue; // the verbatim review quote/author are verified below instead
    const kt = kn(text);
    for (const f of forbidden) if (wholeToken(kt, f)) add(platform, f, "contains a forbidden claim");

    for (const sentence of splitSentences(text)) scanNumbers(platform, sentence);

    for (const sentence of splitSentences(text)) {
      const ks = kn(sentence);
      for (const { k, re } of KEYWORD_RES) {
        if (re.test(ks) && !keywordCovered(ks, k, re, validCites)) {
          add(platform, sentence.trim(), "unsupported claim keyword without citation");
        }
      }
    }
  }

  // hashtags: camel-case words get the full floor (forbidden values, numbers, keywords covered inside the tag)
  for (const [pl, pc] of Object.entries(copy) as [Platform, { hashtags: string[] } | undefined][]) {
    for (const tag of pc?.hashtags ?? []) {
      const words = hashtagWords(tag);
      if (!words) continue;
      for (const f of forbidden) if (wholeToken(words, f)) add(pl, tag, "contains a forbidden claim");
      // a hashtag has no separators, so a bare 7+ digit run is read as a phone number
      const phones: Pattern[] = [...words.matchAll(/(?<!\d)\d{7,}(?!\d)/g)].map((m) => ({ kind: "phone", text: m[0] }));
      const raw = tag.replace(/^#/, "").toLowerCase().replace(/[^a-z0-9%$.]/g, "");
      scanNumbers(pl, words, tag, [...phones, ...rawTagPatterns(raw)]);
      // run-together tags ("#freetuneup"): keywords found as substrings that the word scan below cannot see
      const rawc = compact(raw);
      for (const { re, c } of RAW_KEYWORDS) {
        if (!rawc.includes(c) || re.test(words)) continue;
        if (!rawKeywordCovered(rawc, c, re, validCites)) add(pl, tag, "unsupported claim keyword without citation");
      }
      for (const { k, re } of KEYWORD_RES) {
        if (re.test(words) && !keywordCovered(words, k, re, validCites)) {
          add(pl, tag, "unsupported claim keyword without citation");
        }
      }
    }
  }

  // review template: quote (body) verbatim at word boundaries, author line (subhead) exact, captions name no one else
  if (reviewText) {
    const review = trimEdges(kn(reviewText));
    const quote = trimEdges(kn(inputs.body ?? ""));
    const okQuote =
      quote.length > 0 &&
      wholeToken(review, quote) &&
      (wordCount(quote) >= 4 || (wordCount(review) < 4 && quote === review));
    if (!okQuote) add("inputs", inputs.body ?? "", "review quote does not match");
    const author = (reviewAuthor ?? "").trim();
    if (!author) add("inputs", inputs.subhead, "review has no author in the Brand Brain");
    else {
      if (kn(inputs.subhead) !== kn(author)) add("inputs", inputs.subhead, "review author does not match");
      for (const [pl, pc] of Object.entries(copy) as [Platform, { caption: string } | undefined][]) {
        for (const name of wrongAttributions(pc?.caption ?? "", author)) add(pl, name, "review author does not match");
      }
    }
  }

  return { ok: !issues.some((i) => !i.warning), issues };
}
