/**
 * types.ts — shared vocabulary and zod schemas for the Creative Studio (plans, creatives, versions).
 *
 * Inputs:  none (pure declarations)
 * Outputs: types, constants and zod schemas
 * Used by: creatives pipeline, API routes (body validation), dashboard client components
 */
import { z } from "zod";

export const PLATFORMS = ["instagram", "facebook", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PlatformSchema = z.enum(PLATFORMS);

export const ASPECTS = ["1:1", "4:5", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const AspectSchema = z.enum(ASPECTS);
export const ASPECT_SIZE: Record<Aspect, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
};

export const TEMPLATE_KEYS = ["product-hero", "offer", "tip-quote", "review"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TemplateKeySchema = z.enum(TEMPLATE_KEYS);

export const CREATIVE_KINDS = ["image", "carousel"] as const;
export type CreativeKind = (typeof CREATIVE_KINDS)[number];
export const CreativeKindSchema = z.enum(CREATIVE_KINDS);

export const VERSION_STATES = ["draft", "approved", "changes_requested", "rejected", "superseded"] as const;
export type VersionState = (typeof VERSION_STATES)[number];
export const CREATIVE_STATUSES = ["draft", "rendering", "ready", "failed"] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];
export const PLAN_STATUSES = ["planning", "generating", "ready", "done"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const CTA_KINDS = ["call", "book", "visit", "message", "website"] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

export const ConceptSchema = z.object({
  slot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platforms: z.array(PlatformSchema).min(1),
  template_key: TemplateKeySchema,
  kind: CreativeKindSchema,
  title: z.string(),
  angle: z.string(),
  product_id: z.string().nullable(),
  claim_refs: z.array(z.string()),
  cta_kind: z.enum(CTA_KINDS),
  hashtags_seed: z.array(z.string()),
});
export type Concept = z.infer<typeof ConceptSchema>;

const SlideSchema = z.object({ headline: z.string(), subhead: z.string() });

export const CreativeInputsSchema = z.object({
  headline: z.string(),
  subhead: z.string(),
  cta_text: z.string(),
  cta_kind: z.string(),
  body: z.string().optional(),
  slides: z.array(SlideSchema).optional(),
  colors: z.object({ primary: z.string(), accent: z.string(), background: z.string(), text: z.string() }),
  logo_asset_id: z.string().nullable(),
  photo_asset_ids: z.array(z.string()),
  background_asset_id: z.string().nullable(),
  background_prompt: z.string().nullable(),
});
export type CreativeInputs = z.infer<typeof CreativeInputsSchema>;

export const PlatformCopySchema = z.object({ caption: z.string(), hashtags: z.array(z.string()) });
export type PlatformCopy = z.infer<typeof PlatformCopySchema>;

export const CreativeCopySchema = z.object({
  instagram: PlatformCopySchema.optional(),
  facebook: PlatformCopySchema.optional(),
  linkedin: PlatformCopySchema.optional(),
});
export type CreativeCopy = Partial<Record<Platform, PlatformCopy>>;

export const ClaimUseSchema = z.object({ text: z.string(), path: z.string() });
export type ClaimUse = z.infer<typeof ClaimUseSchema>;

export const GroundingSchema = z.object({
  ok: z.boolean(),
  issues: z.array(
    z.object({
      platform: z.union([PlatformSchema, z.literal("inputs")]),
      text: z.string(),
      reason: z.string(),
      warning: z.boolean().optional(),
    }),
  ),
});
export type Grounding = z.infer<typeof GroundingSchema>;

export const RenderRefSchema = z.object({
  aspect: AspectSchema,
  slide: z.number().int().nullable(),
  asset_id: z.string(),
  public_url: z.string(),
  width: z.number(),
  height: z.number(),
});
export type RenderRef = z.infer<typeof RenderRefSchema>;
