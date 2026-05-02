/**
 * data.ts — Typed loader for src/data.json (the per-build site payload).
 *
 * Inputs:  src/data.json (written by web/lib/pipeline/stage-3-generate.ts)
 * Outputs: typed `SiteData` object
 * Used by: every page + component in this template
 */

import raw from "../data.json";

export interface Palette {
  primary: string;
  primary_text: string;
  accent: string;
  surface: string;
  surface_alt: string;
  neutral_900: string;
  neutral_500: string;
}

export interface Variants {
  hero: "parallax-photos" | "animated-gradient";
  services: "bento-grid";
  reviews: "marquee" | "hidden";
  trust: "animated-strip" | "hidden";
  service_area: "styled-list";
  cta: "sticky-bar";
}

export interface ServiceCopy {
  slug: string;
  name: string;
  short_description: string;
  detail_paragraph: string;
  bullets: string[];
}

export interface SiteCopy {
  hero_tagline: string;
  hero_subhead: string;
  trust_strip: string[];
  about_paragraph: string;
  about_why_us: string[];
  services: ServiceCopy[];
  service_area_intro: string;
  contact_blurb: string;
  meta_description: string;
  cta_primary: string;
  cta_secondary: string;
  social_proof_line: string;
  urgency_micro: string;
}

export interface ReviewItem {
  author?: string;
  rating?: number;
  text?: string;
}

export interface SiteData {
  business_name: string;
  phone: string | null;
  email?: string | null;
  address: string | null;
  brand_color: string;
  category?: string | null;
  rating: number | null;
  review_count: number | null;
  palette: Palette;
  variants: Variants;
  photos: string[];
  reviews: ReviewItem[];
  service_areas: string[];
  business_hours: Record<string, string> | null;
  copy: SiteCopy;
  /** Logo URL or data URI (monogram fallback). May be null on legacy builds. */
  logo_url?: string | null;
  /** True for mobile / service-area-only businesses (no fixed address). Toggles
   *  contact-page rendering and removes the map embed. */
  is_service_area_only?: boolean;
}

export const data = raw as unknown as SiteData;
export default data;
