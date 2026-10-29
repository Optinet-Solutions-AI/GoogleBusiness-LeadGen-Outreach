/**
 * registry.ts — pure metadata for the four post templates (safe to import from client components).
 *
 * Inputs:  none
 * Outputs: TEMPLATES record keyed by TemplateKey
 * Used by: templates/index.ts (re-export), Creative Studio UI, concept planner
 */
import type { CreativeInputs, TemplateKey } from "../types";

export interface TemplateMeta {
  label: string;
  needsPhoto: boolean;
  defaultBackground: boolean;
  supportsCarousel: boolean;
  inputFields: (keyof CreativeInputs)[];
}

export const TEMPLATES: Record<TemplateKey, TemplateMeta> = {
  "product-hero": {
    label: "Product hero",
    needsPhoto: true,
    defaultBackground: false,
    supportsCarousel: true,
    inputFields: ["headline", "subhead", "cta_text", "photo_asset_ids", "logo_asset_id", "colors"],
  },
  offer: {
    label: "Offer",
    needsPhoto: false,
    defaultBackground: true,
    supportsCarousel: true,
    inputFields: ["headline", "subhead", "cta_text", "background_asset_id", "background_prompt", "logo_asset_id", "colors"],
  },
  "tip-quote": {
    label: "Tip / quote",
    needsPhoto: false,
    defaultBackground: true,
    supportsCarousel: true,
    inputFields: ["headline", "subhead", "cta_text", "background_asset_id", "background_prompt", "logo_asset_id", "colors"],
  },
  review: {
    label: "Customer review",
    needsPhoto: false,
    defaultBackground: false,
    supportsCarousel: false,
    inputFields: ["headline", "body", "subhead", "cta_text", "logo_asset_id", "colors"],
  },
};
