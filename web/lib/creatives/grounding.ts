/**
 * grounding.ts — pure caption grounding check: every factual claim must exist in the client's Brand Brain.
 *
 * Inputs:  generated copy + template inputs, the model's claims_used citations, BrandProfileData, product snapshots
 * Outputs: Grounding { ok, issues[] } (unconfirmed-only matches are warnings and keep ok true)
 * Used by: creative copy pipeline (version creation / edits), approval gating
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

// Word keywords match whole words (optional s/d/ed suffix); symbolic ones match as written.
// "%" and "$" are covered by the price/percent pattern floor, not by the sentence rule.
const KEYWORD_RES = CLAIM_KEYWORDS.filter((k) => k !== "%" && k !== "$").map((k) => {
  const esc = k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const alpha = /^[a-z]+$/.test(k);
  return { k, re: new RegExp(String.raw`(?<![a-z0-9])${esc}${alpha ? "(?:s|d|ed)?" : ""}(?![a-z0-9])`, "i") };
});

const digitsOnly = (s: string) => s.replace(/\D/g, "");

export function extractPatterns(text: string): Pattern[] {
  const out: Pattern[] = [];
  for (const m of text.matchAll(PRICE_RE)) out.push({ kind: "price", text: m[0].trim() });
  for (const m of text.matchAll(PERCENT_RE)) out.push({ kind: "percent", text: m[0].trim() });
  for (const m of text.matchAll(YEAR_RE)) out.push({ kind: "year", text: m[0] });
  for (const m of text.matchAll(PHONE_RE)) {
    if (digitsOnly(m[0]).length >= 7 && /[\s().+-]/.test(m[0])) out.push({ kind: "phone", text: m[0].trim() });
  }
  for (const { k, re } of KEYWORD_RES) if (re.test(text)) out.push({ kind: "keyword", text: k });
  return out;
}

/** True when `needle` occurs in `hay` not glued to a longer number ("8" is not in "89" or "8.95"). */
function hasNumberToken(hay: string, needle: string): boolean {
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const before = hay[i - 1] ?? "";
    const after = hay[i + needle.length] ?? "";
    const after2 = hay[i + needle.length + 1] ?? "";
    const glued =
      /\d/.test(before) ||
      (/[.,]/.test(before) && /\d/.test(hay[i - 2] ?? "")) ||
      /\d/.test(after) ||
      (/[.,]/.test(after) && /\d/.test(after2));
    if (!glued) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
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

const isFact = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "value" in v && "confirmed" in v;

export function factCorpus(
  profile: BrandProfileData,
  products: ProductSnapshot[],
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
  walk({ business: profile.business, voice: profile.voice, audiences: profile.audiences, claims: profile.claims, ctas: profile.ctas, social: profile.social });
  for (const p of products) {
    const bucket = p.confirmed ? confirmed : unconfirmed;
    for (const s of [p.name, p.description, p.price, p.category]) if (s) bucket.push(s);
  }
  const norm = (a: string[]) => a.map(normalizeForMatch).filter(Boolean);
  return { confirmed: norm(confirmed), unconfirmed: norm(unconfirmed) };
}

const BAD = new Set(["__proto__", "constructor", "prototype"]);

/** Text at a dotted/[n] path, or a product id; "" when absent. Never throws. */
function textAtPath(path: string, profile: BrandProfileData, products: ProductSnapshot[]): string {
  const strs: string[] = [];
  const byId = products.find((p) => p.id !== undefined && p.id === path);
  if (byId) {
    leafStrings([byId.name, byId.description, byId.price, byId.category], strs);
    return strs.join(" \n ");
  }
  const parts = path.replace(/\[\]$/, "").split(".");
  let cur: unknown = { ...profile, products };
  for (const part of parts) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m || BAD.has(m[1])) return "";
    if (typeof cur !== "object" || cur === null) return "";
    cur = (cur as Obj)[m[1]];
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return "";
      cur = cur[Number(idx[1])];
    }
  }
  leafStrings(cur, strs);
  return strs.join(" \n ");
}

type TextSlot = { platform: Platform | "inputs"; text: string };

const splitSentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

export function checkGrounding(input: {
  copy: CreativeCopy;
  inputs: CreativeInputs;
  claimsUsed: ClaimUse[];
  profile: BrandProfileData;
  products: ProductSnapshot[];
  reviewText?: string | null;
}): Grounding {
  const { copy, inputs, claimsUsed, profile, products, reviewText } = input;
  const issues: Grounding["issues"] = [];
  const corpus = factCorpus(profile, products);
  const add = (platform: TextSlot["platform"], text: string, reason: string, warning?: boolean) => {
    if (issues.some((i) => i.platform === platform && i.text === text && i.reason === reason)) return;
    issues.push(warning ? { platform, text, reason, warning: true } : { platform, text, reason });
  };

  // (b) cite-and-verify
  const cites = claimsUsed.map((c) => normalizeForMatch(c.text)).filter(Boolean);
  for (const c of claimsUsed) {
    const hay = normalizeForMatch(textAtPath(c.path, profile, products));
    const needle = normalizeForMatch(c.text);
    if (!needle || !hay.includes(needle)) add("inputs", c.text, "cited path does not contain this text");
  }

  const slots: TextSlot[] = [];
  for (const [pl, pc] of Object.entries(copy) as [Platform, { caption: string } | undefined][]) {
    if (pc) slots.push({ platform: pl, text: pc.caption });
  }
  slots.push({ platform: "inputs", text: inputs.headline }, { platform: "inputs", text: inputs.subhead });
  if (!reviewText && inputs.body) slots.push({ platform: "inputs", text: inputs.body });
  for (const s of inputs.slides ?? []) {
    slots.push({ platform: "inputs", text: s.headline }, { platform: "inputs", text: s.subhead });
  }

  const inBucket = (kind: PatternKind, text: string, bucket: string[]): boolean => {
    const t = normalizeForMatch(text);
    if (kind === "phone") {
      const d = digitsOnly(t);
      return bucket.some((b) => (b.match(PHONE_RE) ?? []).some((p) => digitsOnly(p) === d));
    }
    if (kind === "year") return bucket.some((b) => hasNumberToken(b, t));
    const num = /\d+(?:[.,]\d+)*/.exec(t)?.[0] ?? t;
    return bucket.some((b) => hasNumberToken(b, num));
  };

  // (a) pattern floor + (c) a claim keyword needs a covering citation in its sentence
  for (const { platform, text } of slots) {
    for (const p of extractPatterns(text)) {
      if (p.kind === "keyword") continue;
      if (inBucket(p.kind, p.text, corpus.confirmed)) continue;
      if (inBucket(p.kind, p.text, corpus.unconfirmed)) add(platform, p.text, "matches an unconfirmed fact", true);
      else add(platform, p.text, "not in brand brain");
    }
    for (const sentence of splitSentences(text)) {
      const ns = normalizeForMatch(sentence);
      const hits = extractPatterns(sentence).filter((p) => p.kind === "keyword");
      if (hits.length && !cites.some((c) => ns.includes(c))) {
        for (const h of hits) add(platform, h.text, "unsupported claim keyword without citation");
      }
    }
  }

  // review template: the quote must appear verbatim (normalised) in the review
  if (reviewText && inputs.body && !normalizeForMatch(reviewText).includes(normalizeForMatch(inputs.body))) {
    add("inputs", inputs.body, "review quote does not match");
  }

  return { ok: !issues.some((i) => !i.warning), issues };
}
