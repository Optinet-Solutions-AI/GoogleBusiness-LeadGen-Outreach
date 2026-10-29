/**
 * schema.ts — Gemini response schemas + zod mirrors for Brand Brain extraction, and the allowed fact paths.
 *
 * Inputs:  EMPTY_PROFILE shape (lib/clients/types.ts) for FACT_PATHS; raw Gemini JSON for the zod parsers
 * Outputs: FACT_PATHS, BRAND_FACTS_SCHEMA, VOICE_SCHEMA, ExtractionOutput / VoiceOutput zod schemas
 * Used by: lib/services/gemini-brand.ts, extraction prompt, fact validation (Task 8)
 */
import { z } from "zod";
import { Type } from "@google/genai";
import { EMPTY_PROFILE, type ExtractedFact } from "@/lib/clients/types";

/** Groups the facts call must NOT fill (voice has its own call; products are a separate list). */
const SKIP_PATHS = new Set(["voice", "products", "visuals.logo_asset_id"]);

function collectPaths(node: unknown, prefix: string, out: string[]): void {
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (SKIP_PATHS.has(path)) continue;
    if (Array.isArray(val)) out.push(`${path}[]`);
    else if (val !== null && typeof val === "object") collectPaths(val, path, out);
    else out.push(path);
  }
}

function deriveFactPaths(): string[] {
  const out: string[] = [];
  collectPaths(EMPTY_PROFILE, "", out);
  return out;
}

/** Every scalar leaf of BrandProfileData as a dotted path, plus every list field with a `[]` suffix. */
export const FACT_PATHS: readonly string[] = deriveFactPaths();

/** Paths whose `value` is an object, JSON-encoded as a string by the model. */
const OBJECT_VALUE_PATHS = new Set(["audiences[]", "ctas[]"]);

const AudienceValue = z.object({
  name: z.string(),
  description: z.string(),
  pains: z.array(z.string()),
  wants: z.array(z.string()),
});
const CtaValue = z.object({
  text: z.string(),
  kind: z.enum(["call", "book", "visit", "message", "website"]),
});

export const BRAND_FACTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    facts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          value: { type: Type.STRING },
          source: { type: Type.STRING },
          quote: { type: Type.STRING, nullable: true },
        },
        required: ["path", "value", "source"],
      },
    },
    products: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING, nullable: true },
          price: { type: Type.STRING, nullable: true },
          category: { type: Type.STRING, nullable: true },
          source: { type: Type.STRING },
          quote: { type: Type.STRING, nullable: true },
          image_asset_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["name", "source", "image_asset_ids"],
      },
    },
  },
  required: ["facts", "products"],
};

export const VOICE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tone: { type: Type.ARRAY, items: { type: Type.STRING } },
    style_notes: { type: Type.STRING },
    do: { type: Type.ARRAY, items: { type: Type.STRING } },
    dont: { type: Type.ARRAY, items: { type: Type.STRING } },
    sample_lines: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["tone", "style_notes", "do", "dont", "sample_lines"],
};

const RawFact = z.object({
  path: z.string(),
  value: z.string(),
  source: z.string().min(1),
  quote: z.string().nullish(),
});

/** Parse a raw fact; object-valued paths are JSON.parsed + shape-checked. Returns null to drop the fact. */
function toFact(raw: z.infer<typeof RawFact>): ExtractedFact | null {
  let value: unknown = raw.value;
  if (OBJECT_VALUE_PATHS.has(raw.path)) {
    try {
      const parsed: unknown = JSON.parse(raw.value);
      const shape = raw.path === "audiences[]" ? AudienceValue : CtaValue;
      const ok = shape.safeParse(parsed);
      if (!ok.success) return null;
      value = ok.data;
    } catch {
      return null;
    }
  }
  return { path: raw.path, value, source: raw.source, quote: raw.quote ?? null };
}

const nullable = z.string().nullish().transform((v) => v ?? null);

export const ExtractionOutput = z
  .object({
    facts: z.array(RawFact),
    products: z.array(
      z.object({
        name: z.string(),
        description: nullable,
        price: nullable,
        category: nullable,
        source: z.string().min(1),
        quote: nullable,
        image_asset_ids: z.array(z.string()).default([]),
      }),
    ),
  })
  .transform((o) => ({
    facts: o.facts.map(toFact).filter((f): f is ExtractedFact => f !== null),
    products: o.products,
  }));
export type ExtractionOutput = z.output<typeof ExtractionOutput>;

export const VoiceOutput = z.object({
  tone: z.array(z.string()),
  style_notes: z.string(),
  do: z.array(z.string()),
  dont: z.array(z.string()),
  sample_lines: z.array(z.string()),
});
export type VoiceOutput = z.infer<typeof VoiceOutput>;
