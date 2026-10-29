/**
 * gemini-creative.ts — Gemini calls for the Creative Studio: monthly concept planning and per-post copy.
 *
 * Inputs:  BrandProfileData + products + slot dates / a Concept + platforms
 * Outputs: zod-validated Concept[] / copy + template inputs + claims_used citations, with token Usage
 * Used by: creative plan generation and creative copy jobs
 */
import "@/lib/server-guard";
import { z } from "zod";
import { Type } from "@google/genai";
import type { Usage } from "@/lib/clients/cost";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import { getLogger } from "@/lib/logger";
import { checkCaptionLimits, PLATFORM_LIMITS } from "@/lib/creatives/limits";
import { guardReviewConcepts, reviewSource } from "@/lib/creatives/select";
import { TEMPLATES } from "@/lib/creatives/templates/registry";
import {
  ClaimUseSchema,
  CTA_KINDS,
  ConceptSchema,
  PLATFORMS,
  TEMPLATE_KEYS,
  type ClaimUse,
  type Concept,
  type CreativeCopy,
  type CreativeInputs,
  type CreativeKind,
  type Platform,
  type TemplateKey,
} from "@/lib/creatives/types";
import { structuredCall } from "@/lib/services/gemini-brand";

const log = getLogger("gemini-creative");

/** Model-side concept: cta_kind is a free string here and is mapped to the enum by repairConcepts. */
const RawConceptSchema = ConceptSchema.extend({ cta_kind: z.string() });
type RawConcept = z.infer<typeof RawConceptSchema>;
export const ConceptsOutput = z.object({ concepts: z.array(RawConceptSchema) });

/** Thrown when captions are still missing for a requested platform or break platform limits after the one corrective retry. */
export class CopyLimitError extends Error {
  constructor(public violations: { platform: Platform; reason: string }[]) {
    super(`copy_limits_exceeded: ${violations.map((v) => `${v.platform} ${v.reason}`).join("; ")}`);
    this.name = "CopyLimitError";
  }
}

export function mapCtaKind(raw: string): (typeof CTA_KINDS)[number] {
  const k = raw.trim().toLowerCase();
  if ((CTA_KINDS as readonly string[]).includes(k)) return k as (typeof CTA_KINDS)[number];
  if (/call|phone|ring/.test(k)) return "call";
  if (/book|schedule|appoint|reserv/.test(k)) return "book";
  if (/visit|stop|store|drop|directions/.test(k)) return "visit";
  if (/message|text|dm|chat|contact|email/.test(k)) return "message";
  return "website";
}
export const CopyOutput = z.object({
  headline: z.string(),
  subhead: z.string(),
  cta_text: z.string(),
  body: z.string().nullish(),
  slides: z.array(z.object({ headline: z.string(), subhead: z.string() })).nullish(),
  captions: z.array(z.object({ platform: z.enum(PLATFORMS), caption: z.string(), hashtags: z.array(z.string()) })),
  claims_used: z.array(ClaimUseSchema),
});

const S = { type: Type.STRING };
const strArr = { type: Type.ARRAY, items: S };
const CONCEPTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slot_date: S,
          platforms: strArr,
          template_key: { type: Type.STRING, enum: [...TEMPLATE_KEYS] },
          kind: { type: Type.STRING, enum: ["image", "carousel"] },
          title: S,
          angle: S,
          product_id: { type: Type.STRING, nullable: true },
          claim_refs: strArr,
          cta_kind: S,
          hashtags_seed: strArr,
        },
        required: ["slot_date", "platforms", "template_key", "kind", "title", "angle", "product_id", "claim_refs", "cta_kind", "hashtags_seed"],
      },
    },
  },
  required: ["concepts"],
};
const COPY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: S,
    subhead: S,
    cta_text: S,
    body: { type: Type.STRING, nullable: true },
    slides: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { headline: S, subhead: S }, required: ["headline", "subhead"] },
    },
    captions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { platform: { type: Type.STRING, enum: [...PLATFORMS] }, caption: S, hashtags: strArr },
        required: ["platform", "caption", "hashtags"],
      },
    },
    claims_used: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { text: S, path: S }, required: ["text", "path"] },
    },
  },
  required: ["headline", "subhead", "cta_text", "captions", "claims_used"],
};

// ---------- profile rendering (every line is `path: value` so the model can cite leaf paths) ----------

type Obj = Record<string, unknown>;
const isFactObj = (v: unknown): v is { value: unknown; confirmed?: boolean } =>
  typeof v === "object" && v !== null && "value" in v && "source" in v;

/**
 * Leaf-path listing of the citable facts (business, claims.allowed, ctas, reviews, products). voice and audiences
 * go under WRITING GUIDANCE without paths; claims.forbidden / voice.dont are listed separately as NEVER.
 */
export function renderFacts(profile: BrandProfileData, products: ProductSnapshot[]): string {
  const lines: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (isFactObj(v)) {
      const val = typeof v.value === "string" ? v.value : JSON.stringify(v.value);
      lines.push(`${path}: ${val}${v.confirmed === false ? "  (unconfirmed)" : ""}`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Obj)) walk(x, path ? `${path}.${k}` : k);
      return;
    }
    if (typeof v === "string" && v.trim()) lines.push(`${path}: ${v}`);
  };
  const { dont: _d, ...voice } = profile.voice;
  void _d;
  walk(profile.business, "business");
  walk(profile.claims.allowed, "claims.allowed");
  walk(profile.ctas, "ctas");
  walk(profile.reviews ?? [], "reviews");
  const prods = products.map((p, i) => {
    const bits = [p.name, p.description, p.price ? `price ${p.price}` : "no price"].filter(Boolean).join(" | ");
    return `products[${i}] id=${p.id ?? "none"}: ${bits}`;
  });
  // voice and audiences are guidance, never evidence (Ruling 29): listed without citable paths
  const before = lines.length;
  walk(voice, "voice");
  walk(profile.audiences, "audiences");
  const guidance = lines.splice(before).map((g) => g.replace(/^(?:voice|audiences)[^:]*: /, "- "));
  return [
    "# BRAND FACTS (cite these paths)",
    ...lines,
    "# PRODUCTS",
    ...prods,
    "# WRITING GUIDANCE (tone only - do not cite, do not copy wording)",
    ...guidance,
  ].join("\n");
}

export function neverBlock(profile: BrandProfileData): string {
  const forb = profile.claims.forbidden.map((f) => `- ${f.value}`).join("\n") || "- (none)";
  const dont = profile.voice.dont.map((f) => `- ${f.value}`).join("\n") || "- (none)";
  return `# NEVER say or imply (forbidden claims; never cite them)\n${forb}\n# VOICE: do not\n${dont}`;
}

/** The review template is only allowed when the Brand Brain holds a real review (reviews[n] with body + author). */
export function hasReviewFact(profile: BrandProfileData): boolean {
  return reviewSource(profile, "") !== null;
}

// ---------- concepts ----------

/** Pure repair: reassign concepts to the given slots in order, pin products, drop carousels on non-carousel templates. */
export function repairConcepts(
  concepts: RawConcept[],
  slots: string[],
  productIdsBySlot: (string | null)[],
  opts: { allowReview?: boolean; platforms?: Platform[] } = {},
): Concept[] {
  const valid = new Set(slots);
  const used = new Set<string>();
  const kept: RawConcept[] = [];
  const spare: RawConcept[] = [];
  for (const c of concepts) {
    if (valid.has(c.slot_date) && !used.has(c.slot_date)) {
      used.add(c.slot_date);
      kept.push(c);
    } else spare.push(c);
  }
  const free = slots.filter((s) => !used.has(s));
  for (const c of spare) {
    const d = free.shift();
    if (!d) break;
    kept.push({ ...c, slot_date: d });
  }
  const bySlot = new Map(kept.map((c) => [c.slot_date, c]));
  if (concepts.length < slots.length) log.warn({ got: concepts.length, slots: slots.length }, "gemini_creative.fewer_concepts_than_slots");
  const out: Concept[] = [];
  slots.forEach((d, i) => {
    const c = bySlot.get(d);
    if (!c) return;
    const template_key: TemplateKey = c.template_key === "review" && opts.allowReview === false ? "tip-quote" : c.template_key;
    const kind: CreativeKind = TEMPLATES[template_key].supportsCarousel ? c.kind : "image";
    out.push({
      ...c,
      template_key,
      kind,
      cta_kind: mapCtaKind(c.cta_kind),
      claim_refs: c.claim_refs.filter((r) => !/^(?:voice|audiences|claims\.forbidden)(?:\.|\[|$)/.test(r)),
      product_id: productIdsBySlot[i] ?? null,
      platforms: opts.platforms?.length ? opts.platforms : c.platforms,
    });
  });
  return out;
}

/** Warns (string) when more than 60% of the concepts share one template; null when the mix is fine. */
export function conceptMixWarning(concepts: Pick<Concept, "template_key">[]): string | null {
  if (concepts.length < 2) return null;
  const counts = new Map<string, number>();
  for (const c of concepts) counts.set(c.template_key, (counts.get(c.template_key) ?? 0) + 1);
  const [key, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n / concepts.length <= 0.6) return null;
  return `${n} of ${concepts.length} concepts share the "${key}" template`;
}

const CONCEPTS_SYSTEM = `You plan a month of social media posts for one local business, using ONLY its Brand Brain.
Return one concept per slot (same count, same dates). Each concept: a distinct angle, varied templates across the month.
Rules (all mandatory):
- template_key is one of: ${TEMPLATE_KEYS.join(", ")}. "review" ONLY when BRAND FACTS list a reviews[n] entry; otherwise never use it.
- kind is "carousel" only for templates that support it (${TEMPLATE_KEYS.filter((k) => TEMPLATES[k].supportsCarousel).join(", ")}); "review" is always "image".
- product_id is exactly the product id pre-assigned to that slot (or null when none was assigned). Use product-hero for product-led posts.
- claim_refs lists LEAF fact paths from the BRAND FACTS (never voice.* or audiences: they are guidance, not facts; tip-quote concepts lean on claims.allowed / business.* facts) (e.g. claims.allowed[2], business.founded, products[3].price); never a group such as "claims" or "business"; never claims.forbidden or voice.dont.
- Template mix is REQUIRED: no more than half of the concepts may share one template; include at least one tip-quote (it needs no product); include a review concept when review is allowed (the facts contain a review); use offer ONLY when a product or fact actually states an offer or claim that supports one.
- Never plan offers, prices, discounts, awards or years that the facts do not contain. cta_kind is one of call, book, visit, message, website, matching the Brand Brain ctas.
- hashtags_seed: 3-6 short hashtag words (no spaces). platforms: exactly the platforms given.
- title is a short internal label; angle is 1-2 sentences describing the idea.`;

export async function proposeConcepts(input: {
  profile: BrandProfileData;
  products: ProductSnapshot[];
  month: string;
  slots: string[];
  platforms: Platform[];
  productIdsBySlot: (string | null)[];
}): Promise<{ concepts: Concept[]; usage: Usage }> {
  const { profile, products, month, slots, platforms, productIdsBySlot } = input;
  const reviewOk = hasReviewFact(profile);
  const slotLines = slots.map((d, i) => `- ${d}: product_id=${productIdsBySlot[i] ?? "null"}`).join("\n");
  const prompt = `Plan concepts for ${month}.
Business: ${profile.business.name?.value ?? "(unnamed)"} (${profile.business.category?.value ?? "local business"})
Platforms: ${platforms.join(", ")}
Review template allowed: ${reviewOk ? "yes" : "NO"}

# SLOTS (exactly one concept each, in order)
${slotLines}

${renderFacts(profile, products)}

${neverBlock(profile)}`;
  const { output, usage } = await structuredCall<z.infer<typeof ConceptsOutput>>({
    label: "concepts",
    system: CONCEPTS_SYSTEM,
    prompt,
    responseSchema: CONCEPTS_SCHEMA,
    zod: ConceptsOutput,
  });
  const repaired = repairConcepts(output.concepts, slots, productIdsBySlot, { platforms });
  const { concepts, converted } = guardReviewConcepts(repaired, profile);
  if (converted) log.warn({ month, converted }, "gemini_creative.review_concepts_converted_no_review_quote");
  const mixWarning = conceptMixWarning(concepts);
  if (mixWarning) log.warn({ month }, `gemini_creative.concept_mix: ${mixWarning}`);
  return { concepts, usage };
}

// ---------- copy ----------

const COPY_SYSTEM = `You write social media copy for one local business, using ONLY its Brand Brain facts and products.
Return template text (headline, subhead, cta_text, body, slides), one caption per requested platform, and claims_used.
Rules (all mandatory):
- Use only facts listed in BRAND FACTS / PRODUCTS. Never invent anything.
- Every factual phrase needs a claims_used entry { "text", "path" }. Factual = any price, percent, year, phone number, and any of these words: guarantee, certified, award, best, #1, only, cheapest, free, since, years, licensed, insured, 24/7, same-day, family-owned, locally.
- "path" is a LEAF fact path exactly as listed under BRAND FACTS (claims.allowed[2], business.founded, business.hours.mon, products[3].price, reviews[0], or a product id). NEVER cite a group such as "claims", "business" or "products", and NEVER cite claims.forbidden, voice.* or audiences.
- A claims_used "text" is the whole factual phrase as the fact writes it (e.g. "Free estimates on new systems"), never a lone keyword such as "free" or "guarantee", and that phrase must appear in the same sentence (or hashtag) that makes the claim.
- Cite a CTA as the list item itself ("ctas[0]"), never "ctas[0].text". WRITING GUIDANCE lines (voice and audiences) are guidance, not facts: never cite them and never copy their wording, numbers or promises into the post.
- Review template: body is a verbatim excerpt (4+ words) of one reviews[n] body, subhead is exactly that review's author, cite it as reviews[n], and never name anyone else as the reviewer.
- Hashtags must not assert anything the facts do not say: keep them generic (service, city, season) with no prices, percents, years or phone numbers; a claim hashtag (#FamilyOwnedAndOperated) needs a citation of the phrase it spells.
- Only cite phrases that are factual (see above) and that actually appear in your output; do not cite ordinary descriptive sentences.
- "text" must be a verbatim excerpt of the cited fact's text AND must appear verbatim (same characters) in the caption or template text you wrote. Return the texts you actually used.
- Never use forbidden claims or their phrases. Avoid the phrasings "feel free", "not only" and "best way" (they trip the claim checker).
- Prices only when a product has that exact price. No years except business.founded. No percentages or discounts unless a fact states them.
- CTA: cta_text comes from the Brand Brain ctas (use its text) or the operator's wording; never invent a phone number or link.
- Match the voice (tone, style_notes, do). Headline is short (max ~8 words); subhead one short line; body only for the review template (a short quote that appears in the facts), otherwise null.
- For carousels give 3-5 slides (headline + subhead each); for single images return an empty slides list.
- Captions respect platform limits: ${PLATFORMS.map((p) => `${p} max ${PLATFORM_LIMITS[p].maxChars} chars and ${PLATFORM_LIMITS[p].maxHashtags} hashtags`).join("; ")}. Hashtags are words without spaces; include the leading #.
- Return a caption only for the requested platforms.
- A claims_used "text" is the literal value exactly as it appears in the facts, NEVER prefixed with the field name: write 18.5, not "price 18.5".
- CTA labels (Book Now, Call Us, Visit Us, ...) are never claims: do not put them in claims_used.
- Format prices the way the facts do (e.g. $18.50).
- Hashtags go ONLY in the hashtags list - never inside the caption text.`;

export async function writeCopy(input: {
  profile: BrandProfileData;
  products: ProductSnapshot[];
  concept: Concept;
  platforms: Platform[];
  templateKey: TemplateKey;
  kind: CreativeKind;
  /** Grounding issues from a previous attempt, appended so the model can fix them. */
  priorIssues?: string[];
}): Promise<{
  copy: CreativeCopy;
  inputs: Pick<CreativeInputs, "headline" | "subhead" | "cta_text" | "body" | "slides">;
  claims_used: ClaimUse[];
  usage: Usage;
}> {
  const { profile, products, concept, platforms, templateKey, kind } = input;
  const product = products.find((p) => p.id !== undefined && p.id === concept.product_id);
  const fixes = input.priorIssues?.length
    ? `\n\n# PREVIOUS DRAFT FAILED THE FACT CHECK - fix these:\n${input.priorIssues.map((i) => `- ${i}`).join("\n")}`
    : "";
  const prompt = `Write copy for this post.
Template: ${templateKey}; kind: ${kind}; platforms: ${platforms.join(", ")}
Concept: ${concept.title} - ${concept.angle}
CTA kind: ${concept.cta_kind}
Suggested hashtag seeds: ${concept.hashtags_seed.join(" ")}
Fact paths the concept leans on: ${concept.claim_refs.join(", ") || "(none)"}
Featured product: ${product ? `${product.name} (id ${product.id})` : "none"}

${renderFacts(profile, products)}

${neverBlock(profile)}${fixes}`;
  let violations: { platform: Platform; reason: string }[] = [];
  const buildCopy = (o: z.infer<typeof CopyOutput>): CreativeCopy => {
    const out: CreativeCopy = {};
    for (const c of o.captions) {
      if (platforms.includes(c.platform) && !out[c.platform]) {
        const max = PLATFORM_LIMITS[c.platform].maxHashtags;
        if (c.hashtags.length > max) log.warn({ platform: c.platform, had: c.hashtags.length, max }, "gemini_creative.hashtags_trimmed");
        out[c.platform] = { caption: c.caption, hashtags: c.hashtags.slice(0, max) };
      }
    }
    return out;
  };
  const validator = {
    safeParse(v: unknown) {
      const r = CopyOutput.safeParse(v);
      if (!r.success) {
        violations = [];
        return r;
      }
      const built = buildCopy(r.data);
      violations = [
        ...platforms
          .filter((p) => !built[p]?.caption.trim())
          .map((p) => ({ platform: p, reason: "caption missing" })),
        ...checkCaptionLimits(built),
      ];
      if (violations.length) {
        return {
          success: false as const,
          error: {
            issues: violations.map((x) => ({
              path: [x.platform],
              message:
                x.reason === "caption missing"
                  ? `caption missing for ${x.platform}; return one caption per requested platform`
                  : `${x.reason}; rewrite shorter`,
            })),
          },
        };
      }
      return r;
    },
  };
  let res: Awaited<ReturnType<typeof structuredCall<z.infer<typeof CopyOutput>>>>;
  try {
    res = await structuredCall<z.infer<typeof CopyOutput>>({
      label: "copy",
      system: COPY_SYSTEM,
      prompt,
      responseSchema: COPY_SCHEMA,
      zod: validator,
    });
  } catch (err) {
    if (violations.length) throw new CopyLimitError(violations);
    throw err;
  }
  const { output, usage } = res;
  const copy = buildCopy(output);
  return {
    copy,
    inputs: {
      headline: output.headline,
      subhead: output.subhead,
      cta_text: output.cta_text,
      ...(output.body ? { body: output.body } : {}),
      ...(kind === "carousel" && output.slides?.length ? { slides: output.slides } : {}),
    },
    claims_used: output.claims_used,
    usage,
  };
}
