/**
 * types.ts — Brand Brain profile schema (zod + inferred types) and the empty profile.
 *
 * Inputs:  nothing (pure definitions)
 * Outputs: zod schemas, TS types, EMPTY_PROFILE
 * Used by: lib/clients/facts.ts, later Brand Brain pipeline stages, client API routes
 */
import { z, type ZodType } from "zod";

export const SourceKind = z.enum(["website", "demo_site", "facebook", "instagram", "google_maps", "operator"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const ClientStatus = z.enum(["pilot", "active", "paused", "churned"]);
export type ClientStatus = z.infer<typeof ClientStatus>;

export const FactSource = z.object({
  kind: SourceKind,
  url: z.string().nullish(),
  page_id: z.string().nullish(),
  quote: z.string().nullish(),
});
export type FactSource = z.infer<typeof FactSource>;

export function fact<T>(value: ZodType<T>) {
  return z.object({ value, source: FactSource, confirmed: z.boolean() });
}
export type Fact<T> = { value: T; source: FactSource; confirmed: boolean };

const Str = fact(z.string());
const StrOrNull = Str.nullable();
const StrList = z.array(Str);

export const Audience = z.object({
  name: z.string(),
  description: z.string(),
  pains: z.array(z.string()),
  wants: z.array(z.string()),
});
/** A real customer review (quote + author), the only source a review-template post may quote (Ruling 30). */
export const Review = z.object({
  body: z.string(),
  author: z.string(),
  rating: z.number().nullable().optional(),
});
export const Cta = z.object({
  text: z.string(),
  kind: z.enum(["call", "book", "visit", "message", "website"]),
});

export const ProductSnapshot = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.string().nullable(),
  category: z.string().nullable(),
  featured: z.boolean(),
  sort: z.number(),
  image_asset_ids: z.array(z.string()),
  source: FactSource,
  confirmed: z.boolean(),
});
export type ProductSnapshot = z.infer<typeof ProductSnapshot>;

export const BrandProfileData = z.object({
  business: z.object({
    name: StrOrNull,
    tagline: StrOrNull,
    description: StrOrNull,
    category: StrOrNull,
    founded: StrOrNull,
    languages: StrList,
    contact: z.object({ phone: StrOrNull, email: StrOrNull, address: StrOrNull, website: StrOrNull }),
    hours: z.object({
      mon: StrOrNull,
      tue: StrOrNull,
      wed: StrOrNull,
      thu: StrOrNull,
      fri: StrOrNull,
      sat: StrOrNull,
      sun: StrOrNull,
    }),
    service_areas: StrList,
  }),
  voice: z.object({
    tone: StrList,
    style_notes: StrOrNull,
    do: StrList,
    dont: StrList,
    sample_lines: StrList,
  }),
  visuals: z.object({
    logo_asset_id: z.string().nullable(),
    colors: z.object({ primary: StrOrNull, accent: StrOrNull, background: StrOrNull, text: StrOrNull }),
    fonts: z.object({ heading: StrOrNull, body: StrOrNull }),
  }),
  audiences: z.array(fact(Audience)),
  claims: z.object({ allowed: StrList, forbidden: StrList }),
  ctas: z.array(fact(Cta)),
  social: z.object({
    facebook: StrOrNull,
    instagram: StrOrNull,
    tiktok: StrOrNull,
    youtube: StrOrNull,
    linkedin: StrOrNull,
  }),
  products: z.array(ProductSnapshot),
  /** Optional (older profiles have none): customer reviews; the review template needs one with body + author. */
  reviews: z.array(fact(Review)).optional(),
});
export type BrandProfileData = z.infer<typeof BrandProfileData>;

export const EMPTY_PROFILE: BrandProfileData = {
  business: {
    name: null,
    tagline: null,
    description: null,
    category: null,
    founded: null,
    languages: [],
    contact: { phone: null, email: null, address: null, website: null },
    hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    service_areas: [],
  },
  voice: { tone: [], style_notes: null, do: [], dont: [], sample_lines: [] },
  visuals: {
    logo_asset_id: null,
    colors: { primary: null, accent: null, background: null, text: null },
    fonts: { heading: null, body: null },
  },
  audiences: [],
  claims: { allowed: [], forbidden: [] },
  ctas: [],
  social: { facebook: null, instagram: null, tiktok: null, youtube: null, linkedin: null },
  products: [],
};

/** A fact the extractor (or operator form) proposes; `source` is a page id, "operator" or "google_maps". */
export type ExtractedFact = { path: string; value: unknown; source: string; quote: string | null };

/** Text the quotes are checked against: a crawled page, or the `operator` / `google_maps` pseudo-page (url null). */
export type PageRef = { id: string; url: string | null; text: string };
