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

/**
 * Theme — page-level identity choices Gemini picks per business.
 * Distinct from Variants which control SECTION-level component swaps.
 * All optional; Base.astro applies sensible defaults when missing.
 */
export interface Theme {
  /** Animated bg layer rendered behind the hero (or whole page).
   *  - "plain": no extra layer, palette/sections do the work
   *  - "aurora-blobs": top blob fades in soft brand-color radials
   *  - "animated-gradient-mesh": shifting brand-color gradient stops */
  background?: "plain" | "aurora-blobs" | "animated-gradient-mesh";
  /** Default look for .btn-primary across the site:
   *  - "solid": current full-pill brand-bg
   *  - "shimmer": conic-gradient border that rotates + dot pattern
   *  - "shining-sweep": diagonal white shine sweep on hover */
  button_style?: "solid" | "shimmer" | "shining-sweep";
  /** Heading + body font pair Gemini selects from. Loads exactly the
   *  needed Google Fonts in Base.astro:
   *  - "editorial-serif": Fraunces + Inter (current default)
   *  - "modern-sans":     Space Grotesk + Inter
   *  - "classical-serif": Cormorant Garamond + Lato */
  font_pair?: "editorial-serif" | "modern-sans" | "classical-serif";
}

export interface Variants {
  hero:
    | "parallax-photos"
    | "animated-gradient"
    | "full-bleed-photo"
    | "split-with-stats"
    | "premium-hero"
    | "editorial-split";
  services: "bento-grid" | "photo-cards" | "minimal-list" | "mixed-cards";
  reviews: "marquee" | "masonry-grid" | "single-featured" | "hidden";
  trust: "animated-strip" | "badge-grid" | "hidden";
  /** About-page layout choice. Each variant is a fully-built .astro
   *  component under components/about/, dispatched from pages/about.astro
   *  and tuned to a niche family. Older builds may lack this; about.astro
   *  falls back to stat-led. */
  about?: "soft-scrapbook" | "stat-led" | "magazine-column";
  /** Service-area page layout. styled-list is the legacy React component;
   *  the four new Astro variants are dispatched from pages/service-area.astro
   *  and pages/index.astro. */
  service_area:
    | "styled-list"
    | "map-editorial"
    | "radius-card"
    | "city-mosaic"
    | "map-pin-cards";
  cta: "sticky-bar" | "full-section";
  /** Per-lead rotation offset for the 5 service-detail layouts. Optional
   *  for back-compat with older data.json blobs. */
  service_detail_offset?: number;
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
  /** Niche-aware override for the services-section eyebrow. Stage-3 sets
   *  this based on niche (e.g. "Practice areas" for legal, "On the menu"
   *  for food). Components fall back to "What we do" when missing. */
  services_eyebrow?: string;
  /** Niche-aware headline template with a {city} placeholder. Stage-3
   *  sets it (e.g. "Counsel for {city}"); components substitute the
   *  city,state string at render time. Fallback "Crafted for {city}". */
  services_headline_template?: string;
}

export interface ReviewItem {
  author?: string;
  rating?: number;
  text?: string;
}

export interface TeamMember {
  name: string;
  role: string;
  /** Optional — when missing, team-grid renders a brand-tinted monogram
   *  fallback instead of a broken image. Real-business leads supply
   *  photo URLs scraped from Google Places / IG / FB; synthetic
   *  showcase leads omit them. */
  photo?: string;
  bio_short?: string;
}

export interface BeforeAfter {
  before_photo: string;
  after_photo: string;
  caption?: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface MenuItem {
  name: string;
  description: string;
  price?: string;
  photo?: string;
}

/**
 * Niche signature — coarse visual-vocabulary dials that drive global.css
 * per-niche overrides BEYOND just the palette hex codes. Two niches with
 * identical structure but different signatures should still feel
 * categorically different to a visitor.
 */
export interface NicheSignature {
  /** Color saturation profile. Drives whether the palette feels muted
   *  (legal/vintage) vs vibrant (food/beauty) vs high-contrast (gym). */
  saturation?: "high" | "balanced" | "desaturated" | "high-contrast-dark";
  /** Body + section surface treatment. Drives whether the page reads
   *  as printed-paper (legal/vintage) vs near-black gym vs blush salon. */
  surface?: "paper-grain" | "cream-wash" | "blush-wash" | "near-black" | "warm-noisy";
  /** Type weight + scale character. Combined with font_pair this nudges
   *  the page's voice — editorial-thin vs condensed-bold vs display-serif. */
  type_scale?: "display-serif-tight" | "editorial-thin" | "condensed-bold" | "casual";
  /** Corner radii character. Legal/gym lean square (0-4px), salon
   *  generous (24-36px), food/vintage soft (8-16px). */
  geometry?: "square" | "tight" | "soft" | "generous";
}

/**
 * Section keys understood by pages/index.astro. The `sections` array on
 * SiteData is rendered IN ORDER. Niches that omit a key simply don't
 * render that section. Adding new keys: extend this union AND the switch
 * in index.astro.
 */
export type SectionKey =
  | "hero"
  | "trust"
  | "services"
  | "reviews"
  | "service-area"
  | "team-grid"
  | "before-after"
  | "faq"
  | "menu-highlights"
  /** Editorial about block on the home page (distinct from the /about
   *  page route). Niches with a story-first feel (vintage, retail,
   *  boutique, event-services) get this in their section order. */
  | "about-block"
  | "cta";

/**
 * Niche bucket that drives palette nuance, photo pool, and per-niche
 * overrides in global.css ([data-niche="..."] selectors). Optional for
 * back-compat with older builds — Base.astro defaults to home-services
 * when missing.
 */
export type NicheKey =
  | "home-services"
  | "landscaping-construction"
  | "beauty-wellness"
  | "professional-services"
  | "food-beverage"
  | "home-goods-vintage"
  | "real-estate"
  | "fitness-pet";

/**
 * DesignFamily — visual rhythm grouping that drives per-family CSS
 * overrides in global.css. Set by stage-3 via web/lib/picker.ts
 * pickDesignFamily(). Templates apply via `data-design-family` body
 * attribute and [data-design-family="..."] selectors in global.css.
 */
export type DesignFamily =
  | "editorial-print"
  | "menu-magazine"
  | "counsel-corporate"
  | "creative-modern"
  | "spa-luxe"
  | "bold-utility"
  | "vibrant-event";

export interface SiteData {
  business_name: string;
  phone: string | null;
  email?: string | null;
  address: string | null;
  brand_color: string;
  category?: string | null;
  /** Niche bucket — drives template-level theming (sharper edges for legal,
   *  warmer ivory bg for boutique, etc.). Stage-3 classifies and writes it. */
  niche?: NicheKey;
  /** Design family — drives visual rhythm via [data-design-family]
   *  selectors in global.css. Set by web/lib/picker.ts pickDesignFamily().
   *  Falls back to "bold-utility" when missing. */
  design_family?: DesignFamily;
  rating: number | null;
  review_count: number | null;
  palette: Palette;
  variants: Variants;
  /** Page-level theme — background overlay, button style, font pair.
   *  All optional; Base.astro applies sensible defaults per niche when
   *  missing or fields are undefined. */
  theme?: Theme;
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

  /** Section composition — drives which sections render and in what order
   *  on the home page. When missing, index.astro falls back to a sensible
   *  default ordering per niche (so older builds still work). */
  sections?: SectionKey[];

  /** Visual-vocabulary signature — drives saturation, surface, type, and
   *  corner geometry overrides in global.css. Optional with niche-aware
   *  defaults in Base.astro. */
  niche_signature?: NicheSignature;

  /** Optional content for niche-specific sections. Each section component
   *  no-ops when its content is missing. */
  team_members?: TeamMember[];
  before_after?: BeforeAfter[];
  faq?: FaqItem[];
  menu_highlights?: MenuItem[];
}

export const data = raw as unknown as SiteData;
export default data;
