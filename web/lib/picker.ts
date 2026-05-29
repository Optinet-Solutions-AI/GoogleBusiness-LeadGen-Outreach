/**
 * picker.ts — Deterministic fallback variant picker.
 *
 * Inputs:  lead row + optional niche key + Gemini-generated SiteCopy
 * Outputs: { hero, services, reviews, trust, service_area, cta } variant slugs
 * Used by: lib/pipeline/stage-3-generate.ts when Gemini's variants are
 *          missing/malformed.
 *
 * Niche-aware rules. Gemini is the primary art director; this function
 * exists as a defensive fallback so a build never lands on a schema-empty
 * variants object. Keep these rules conservative — they should produce a
 * "good but not surprising" choice.
 *
 * Adding a variant: also expand templates/<slug>/src/lib/data.ts Variants
 * type AND lib/services/gemini.ts (AiVariants + RESPONSE_SCHEMA enum).
 */
import { classifyNiche, type NicheKey } from "./niche";

/**
 * Page-level theme dimensions (background overlay, button style, font pair)
 * — kept in sync with templates/premium-trades/src/lib/data.ts Theme type
 * AND web/lib/services/gemini.ts AiTheme.
 */
export interface Theme {
  background: "plain" | "aurora-blobs" | "animated-gradient-mesh";
  button_style: "solid" | "shimmer" | "shining-sweep";
  font_pair: "editorial-serif" | "modern-sans" | "classical-serif";
}

/**
 * Niche-keyed default theme used when Gemini doesn't return a theme block.
 * Each combo is hand-tuned per niche to land the right vibe out of the box.
 */
export function pickTheme(niche: NicheKey): Theme {
  switch (niche) {
    // Professional / legal / financial — restraint.
    case "professional-legal-financial":
    case "real-estate":
      return { background: "plain", button_style: "shimmer", font_pair: "classical-serif" };

    // Creative / tech — modern + animated.
    case "professional-creative-tech":
      return { background: "animated-gradient-mesh", button_style: "shimmer", font_pair: "modern-sans" };

    // Beauty / spa / event styling — editorial / luxe.
    case "beauty-hair-nails":
    case "spa-massage-wellness":
    case "event-services":
    case "boutique-gift-retail":
      return { background: "aurora-blobs", button_style: "solid", font_pair: "editorial-serif" };

    // Vintage / home decor — editorial-warm.
    case "vintage-antiques-thrift":
    case "home-decor-retail":
      return { background: "aurora-blobs", button_style: "solid", font_pair: "editorial-serif" };

    // Food — appetite warmth.
    case "food-restaurants":
    case "food-cafe-bakery":
    case "food-catering-events":
      return { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "editorial-serif" };

    // Fitness / pets — kinetic.
    case "fitness-gyms":
    case "pet-services":
      return { background: "animated-gradient-mesh", button_style: "shining-sweep", font_pair: "modern-sans" };

    // Entertainment — energetic + atmospheric. Venues lean toward
    // animated gradient (neon/atmospheric); performer-services lean
    // shimmer (stage spotlight) on a plainer background so the act
    // photos read clearly.
    case "entertainment-venues":
      return { background: "animated-gradient-mesh", button_style: "shining-sweep", font_pair: "modern-sans" };
    case "entertainment-services":
      return { background: "plain", button_style: "shimmer", font_pair: "modern-sans" };

    // Automotive — hard surfaces.
    case "automotive":
      return { background: "animated-gradient-mesh", button_style: "solid", font_pair: "modern-sans" };

    // All trades fallback.
    case "home-services-trades":
    case "cleaning-restoration":
    case "roofing-exterior":
    case "landscaping-outdoor":
    case "construction-remodel":
    default:
      return { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "modern-sans" };
  }
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
  /** Service-detail page rotation offset, 0–4. Determines which of the
   *  5 service-detail layout components the FIRST service uses; the
   *  remaining services rotate from there. Cross-lead diversity comes
   *  from picking a different offset per neighbor lead. */
  service_detail_offset: number;
  reviews: "marquee" | "masonry-grid" | "single-featured" | "hidden";
  trust: "animated-strip" | "badge-grid" | "hidden";
  /** About-page layout. Three components in templates/.../about/:
   *  - soft-scrapbook  → boutique / event / florist / beauty / spa / food
   *  - stat-led        → trades / professional / automotive (proof-led)
   *  - magazine-column → vintage / home-decor / real-estate / editorial */
  about: "soft-scrapbook" | "stat-led" | "magazine-column";
  /** Service-area-page layout. Four Astro components + the legacy React
   *  one. Choice is driven by niche, area count, and is_service_area_only. */
  service_area:
    | "map-editorial"
    | "radius-card"
    | "city-mosaic"
    | "map-pin-cards"
    | "styled-list";
  cta: "sticky-bar" | "full-section";
}

interface PickInput {
  rating?: number | null;
  review_count?: number | null;
  photos?: Array<unknown>;
  trust_strip?: string[];
  category?: string | null;
  niche?: NicheKey;
  /** Count of service_areas. Drives service_area variant selection:
   *  many areas → map-pin-cards; mobile-only → radius-card; photogenic
   *  → city-mosaic; default → map-editorial. */
  service_areas_count?: number;
  /** True for mobile / no-fixed-location businesses. Drives the
   *  radius-card service_area variant. */
  is_service_area_only?: boolean | null;
  /** Variants used by recent same-niche leads. When the deterministic
   *  choice for a slot is already in the avoid set, swap to the
   *  configured alternative for that slot. Niche-fit still wins —
   *  these are "prefer not to repeat" hints, not hard exclusions. */
  avoid?: {
    hero?: string[];
    services?: string[];
    reviews?: string[];
    trust?: string[];
    about?: string[];
    service_area?: string[];
    cta?: string[];
  };
}

/**
 * For each slot, the ordered fallback chain when the primary pick is in
 * the avoid set. We walk the chain in order, picking the first option
 * that ISN'T in avoid. If all options are exhausted, fall back to the
 * primary anyway (niche-fit > diversity).
 */
const HERO_FALLBACKS: Record<Variants["hero"], Variants["hero"][]> = {
  "premium-hero":       ["editorial-split", "split-with-stats", "animated-gradient", "full-bleed-photo", "parallax-photos"],
  "animated-gradient":  ["premium-hero", "editorial-split", "split-with-stats", "full-bleed-photo", "parallax-photos"],
  "editorial-split":    ["full-bleed-photo", "parallax-photos", "split-with-stats", "premium-hero", "animated-gradient"],
  "full-bleed-photo":   ["editorial-split", "parallax-photos", "split-with-stats", "animated-gradient", "premium-hero"],
  "split-with-stats":   ["editorial-split", "full-bleed-photo", "parallax-photos", "premium-hero", "animated-gradient"],
  "parallax-photos":    ["editorial-split", "full-bleed-photo", "split-with-stats", "animated-gradient", "premium-hero"],
};
const SERVICES_FALLBACKS: Record<Variants["services"], Variants["services"][]> = {
  "minimal-list": ["bento-grid", "mixed-cards", "photo-cards"],
  "photo-cards":  ["mixed-cards", "bento-grid", "minimal-list"],
  "bento-grid":   ["mixed-cards", "photo-cards", "minimal-list"],
  "mixed-cards":  ["photo-cards", "bento-grid", "minimal-list"],
};
const REVIEWS_FALLBACKS: Record<Exclude<Variants["reviews"], "hidden">, Exclude<Variants["reviews"], "hidden">[]> = {
  "marquee":          ["masonry-grid", "single-featured"],
  "masonry-grid":     ["marquee", "single-featured"],
  "single-featured":  ["masonry-grid", "marquee"],
};
const TRUST_FALLBACKS: Record<Exclude<Variants["trust"], "hidden">, Exclude<Variants["trust"], "hidden">[]> = {
  "animated-strip": ["badge-grid"],
  "badge-grid":     ["animated-strip"],
};
const CTA_FALLBACKS: Record<Variants["cta"], Variants["cta"][]> = {
  "sticky-bar":   ["full-section"],
  "full-section": ["sticky-bar"],
};
const ABOUT_FALLBACKS: Record<Variants["about"], Variants["about"][]> = {
  "soft-scrapbook":  ["magazine-column", "stat-led"],
  "stat-led":        ["magazine-column", "soft-scrapbook"],
  "magazine-column": ["soft-scrapbook", "stat-led"],
};
// Excludes "styled-list" — that's the legacy variant we only keep as a
// rendering fallback for unmigrated data.json blobs. New picks always
// land on one of the four new variants.
const SERVICE_AREA_FALLBACKS: Record<
  Exclude<Variants["service_area"], "styled-list">,
  Exclude<Variants["service_area"], "styled-list">[]
> = {
  "map-editorial": ["map-pin-cards", "city-mosaic", "radius-card"],
  "radius-card":   ["map-editorial", "city-mosaic", "map-pin-cards"],
  "city-mosaic":   ["map-editorial", "map-pin-cards", "radius-card"],
  "map-pin-cards": ["map-editorial", "city-mosaic", "radius-card"],
};

/** Walk the fallback chain to find the first option not in `avoid`. */
function diversifyPick<T extends string>(
  primary: T,
  fallbacks: T[],
  avoid: string[] | undefined,
): T {
  if (!avoid || avoid.length === 0 || !avoid.includes(primary)) return primary;
  for (const alt of fallbacks) {
    if (!avoid.includes(alt)) return alt;
  }
  return primary;
}

const PROFESSIONAL: NicheKey[] = [
  "professional-legal-financial",
  "professional-creative-tech",
];
const PHOTOGENIC: NicheKey[] = [
  "beauty-hair-nails",
  "spa-massage-wellness",
  "food-restaurants",
  "food-cafe-bakery",
  "food-catering-events",
  "real-estate",
  "vintage-antiques-thrift",
  "home-decor-retail",
  "event-services",
  "boutique-gift-retail",
  // Entertainment niches lean photo-driven — stage lights, neon, performers
  "entertainment-venues",
  "entertainment-services",
];
const HIGH_INTENT: NicheKey[] = [
  "home-services-trades",
  "cleaning-restoration",
  "roofing-exterior",
  "landscaping-outdoor",
  "construction-remodel",
  "automotive",
];

export function pickVariants(lead: PickInput): Variants {
  const niche = lead.niche ?? classifyNiche(lead.category ?? null);
  const photoCount = lead.photos?.length ?? 0;
  const reviewCount = lead.review_count ?? 0;
  const rating = lead.rating ?? 0;
  const trustCount = lead.trust_strip?.length ?? 0;

  // ── HERO ────────────────────────────────────────────────────────────────
  let hero: Variants["hero"];
  if (PROFESSIONAL.includes(niche) && reviewCount >= 50) {
    // High-trust professional services with proof: animated blob mesh +
    // word-by-word title reveal reads as an award-winning agency site.
    hero = "premium-hero";
  } else if (PROFESSIONAL.includes(niche)) {
    hero = "animated-gradient";  // photos feel stocky for lawyers/accountants
  } else if (PHOTOGENIC.includes(niche) && photoCount >= 1 && rating >= 4.5 && reviewCount >= 25) {
    // Photogenic niches with strong proof: editorial-split's typography-led
    // calm + brand-tinted photo reads as a magazine feature, not a SaaS hero.
    hero = "editorial-split";
  } else if (PHOTOGENIC.includes(niche) && photoCount >= 1) {
    hero = "full-bleed-photo";  // cinematic single image
  } else if (rating >= 4.5 && reviewCount >= 50 && photoCount >= 1) {
    hero = "split-with-stats";  // lead with social proof
  } else if (photoCount >= 6) {
    hero = "parallax-photos";
  } else {
    hero = "animated-gradient";
  }

  // ── SERVICES ────────────────────────────────────────────────────────────
  let services: Variants["services"];
  if (PROFESSIONAL.includes(niche)) services = "minimal-list";
  else if (PHOTOGENIC.includes(niche)) services = "photo-cards";
  else services = "bento-grid";

  // ── REVIEWS ─────────────────────────────────────────────────────────────
  let reviews: Variants["reviews"];
  if (reviewCount < 3) reviews = "hidden";
  else if (reviewCount >= 50) reviews = "masonry-grid";  // wall of proof
  else if (reviewCount < 10) reviews = "single-featured"; // lean on quality
  else reviews = "marquee";

  // ── TRUST ───────────────────────────────────────────────────────────────
  let trust: Variants["trust"];
  if (trustCount < 3) trust = "hidden";
  else if (PROFESSIONAL.includes(niche) || HIGH_INTENT.includes(niche)) trust = "badge-grid";
  else trust = "animated-strip";

  // ── CTA ─────────────────────────────────────────────────────────────────
  // sticky-bar always renders globally; this picks the in-page CTA section.
  const cta: Variants["cta"] = HIGH_INTENT.includes(niche) ? "full-section" : "sticky-bar";

  // ── ABOUT ───────────────────────────────────────────────────────────────
  // Three layout families. soft-scrapbook for photogenic boutique-feel
  // niches (the asymmetric collage), stat-led for proof-led trades /
  // professional / automotive (big numerals over photos), magazine-column
  // for editorial story-led niches (vintage / home-decor / real-estate).
  let about: Variants["about"];
  if (PHOTOGENIC.includes(niche) && photoCount >= 2) {
    // Salons / boutiques / florists / event / spa / food — the collage
    // sells the vibe better than stats ever could.
    about = "soft-scrapbook";
  } else if (
    niche === "vintage-antiques-thrift" ||
    niche === "home-decor-retail" ||
    niche === "real-estate" ||
    niche === "professional-legal-financial"
  ) {
    // Story-led niches. Magazine column reads like a print feature —
    // gravitas legal can't fake, story vintage businesses need to land.
    about = "magazine-column";
  } else if (HIGH_INTENT.includes(niche) || PROFESSIONAL.includes(niche)) {
    // Trades / cleaning / roofing / automotive / professional — proof
    // (rating, areas served, % local-owned, days open) drives trust.
    about = "stat-led";
  } else {
    about = "stat-led";
  }

  // ── SERVICE AREA ───────────────────────────────────────────────────────
  // Four real layouts (plus the legacy styled-list as a final rendering
  // fallback we never actively pick). Selection rules:
  //   - is_service_area_only        → radius-card (no fixed shop to pin)
  //   - photogenic + ≥1 photo       → city-mosaic
  //   - many areas (>=5)            → map-pin-cards
  //   - otherwise                   → map-editorial (default)
  const areaCount = lead.service_areas_count ?? 0;
  type ActiveServiceArea = Exclude<Variants["service_area"], "styled-list">;
  let service_area: ActiveServiceArea;
  if (lead.is_service_area_only) {
    service_area = "radius-card";
  } else if (PHOTOGENIC.includes(niche) && photoCount >= 1 && areaCount >= 2) {
    service_area = "city-mosaic";
  } else if (areaCount >= 5) {
    service_area = "map-pin-cards";
  } else {
    service_area = "map-editorial";
  }

  // ── Photo-count clamp ───────────────────────────────────────────────────
  hero = clampHeroToPhotos(hero, photoCount);

  // ── Diversity bias against recent same-niche picks ──────────────────────
  // When the deterministic choice matches a variant a recent neighbor
  // lead already shipped, walk that slot's fallback chain to find the
  // first equally-fit option. Niche/photo/review constraints still won
  // above — we never produce a structurally-wrong variant just to avoid
  // a repeat.
  const avoid = lead.avoid ?? {};
  hero = diversifyPick(hero, HERO_FALLBACKS[hero], avoid.hero);
  // After diversity, re-clamp in case the swap landed on a hero that
  // needs more photos than we have.
  hero = clampHeroToPhotos(hero, photoCount);
  services = diversifyPick(services, SERVICES_FALLBACKS[services], avoid.services);
  if (reviews !== "hidden") {
    reviews = diversifyPick(
      reviews,
      REVIEWS_FALLBACKS[reviews as Exclude<Variants["reviews"], "hidden">],
      avoid.reviews,
    );
  }
  if (trust !== "hidden") {
    trust = diversifyPick(
      trust,
      TRUST_FALLBACKS[trust as Exclude<Variants["trust"], "hidden">],
      avoid.trust,
    );
  }
  const ctaFinal = diversifyPick(cta, CTA_FALLBACKS[cta], avoid.cta);
  const aboutFinal = diversifyPick(about, ABOUT_FALLBACKS[about], avoid.about);
  // service_area diversity: the picker logic above never returns the
  // legacy "styled-list", so we always walk the new 4-variant fallback
  // chain. (The Variants type still admits "styled-list" purely so a
  // stale data.json from before this change renders cleanly.)
  const serviceAreaFinal = diversifyPick(
    service_area,
    SERVICE_AREA_FALLBACKS[service_area],
    avoid.service_area,
  );

  // Service-detail-page rotation offset. We pick the value LEAST present
  // in the avoid set (the offsets already used by recent neighbor leads),
  // falling back to a stable hash when the avoid set is empty so two
  // identical-niche/photo/rating leads still pick different offsets at
  // first build.
  const offsetAvoid = new Set(
    (avoid as { service_detail_offset?: string[] }).service_detail_offset?.map((n) => parseInt(n, 10)) ?? [],
  );
  let serviceDetailOffset = 0;
  for (let i = 0; i < 5; i++) {
    if (!offsetAvoid.has(i)) {
      serviceDetailOffset = i;
      break;
    }
  }

  return {
    hero,
    services,
    reviews,
    trust,
    about: aboutFinal,
    service_area: serviceAreaFinal,
    cta: ctaFinal,
    service_detail_offset: serviceDetailOffset,
  };
}

/**
 * SectionKey — section bins recognized by templates/premium-trades/src/
 * pages/index.astro. Mirrors the union there so stage-3 can hand the
 * template a niche-tuned ordering.
 *
 * Why a duplicate type: web/ and templates/ are separate TS roots; a
 * shared types package would be cleaner but the indirection costs more
 * than the duplication. Keep this in sync with data.ts SectionKey.
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
  | "about-block"
  | "cta";

/**
 * 20 niches → 20 unique section orderings. Earlier this code grouped
 * niches into 9 families (e.g. beauty + spa shared one ordering), so
 * a side-by-side audit revealed that two niches in the same family
 * shipped identical page skeletons. Now each niche has at least one
 * distinguishing move — section moved up, swapped, added, dropped —
 * so 20 niches read as 20 categorically different pages.
 *
 * Design moves used:
 *   - Section presence: which of the 11 keys appear at all
 *   - Position: where in the flow each appears (about leads vs closes)
 *   - Pairing: which two sections share a "block" (team-next-to-
 *     services vs team-next-to-reviews)
 *   - Reviews placement: before-area = social-proof-first; after-
 *     services = let-the-work-speak; closing = reassure-on-exit
 */
export function pickSectionOrder(niche: NicheKey): SectionKey[] {
  switch (niche) {
    // ── Trades — each gets a distinctive emphasis ───────────────────
    case "home-services-trades":
      // Plumbing/HVAC/electric: trust + speed. No transformation
      // visuals, no story (it's a utility purchase).
      return ["hero", "trust", "services", "service-area", "reviews", "cta"];

    case "cleaning-restoration":
      // Restoration is anchored on visible transformation. Lead with
      // before/after, then trust, then services.
      return ["hero", "before-after", "trust", "services", "service-area", "reviews", "cta"];

    case "roofing-exterior":
      // Roofing: trust matters most (one shot to replace a roof).
      // Trust → photo proof → services → CTA → reviews close.
      return ["hero", "trust", "before-after", "services", "service-area", "cta", "reviews"];

    case "landscaping-outdoor":
      // Landscaping is portfolio-first; show the work, then explain.
      return ["hero", "before-after", "services", "trust", "reviews", "service-area", "cta"];

    case "construction-remodel":
      // Remodel: services (scope) → before-after (proof) → team (who
      // swings the hammer). Heavy trust-building flow.
      return ["hero", "trust", "services", "before-after", "team-grid", "reviews", "cta"];

    case "automotive":
      // Auto repair: trust + services + service-area paired tightly
      // (must be local). Reviews close.
      return ["hero", "trust", "services", "service-area", "reviews", "cta"];

    // ── Beauty / wellness / fitness / pet — each distinct ────────────
    case "beauty-hair-nails":
      // Salon: people-led (stylist matters). Vibe first (services +
      // team), then proof, then story.
      return ["hero", "services", "team-grid", "reviews", "about-block", "cta"];

    case "spa-massage-wellness":
      // Spa: guests come for the EXPERIENCE. Open with the story,
      // then services + team, then reviews.
      return ["hero", "about-block", "services", "team-grid", "reviews", "cta"];

    case "fitness-gyms":
      // Gyms: trust + community. Trust strip (accreditations) →
      // services (programs) → coaches → reviews. No service-area
      // (members travel TO the gym).
      return ["hero", "trust", "services", "team-grid", "reviews", "cta"];

    case "pet-services":
      // Pet services: convenience matters (where can I drop off my
      // dog?). Service-area early, then services, then groomers,
      // then reviews.
      return ["hero", "service-area", "services", "team-grid", "reviews", "cta"];

    // ── Food — 3 niches with distinct flavors ────────────────────────
    case "food-restaurants":
      // Restaurant: menu first, then story, then reviews. Service-
      // area closes (delivery zone).
      return ["hero", "menu-highlights", "about-block", "reviews", "service-area", "cta"];

    case "food-cafe-bakery":
      // Cafe/bakery: menu + services (catering / classes) + reviews.
      // No story block — keep it light and product-first.
      return ["hero", "menu-highlights", "services", "reviews", "service-area", "cta"];

    case "food-catering-events":
      // Catering: portfolio (services) first, menu second, then team
      // (the chefs matter), then reviews. They're an event vendor.
      return ["hero", "services", "menu-highlights", "team-grid", "reviews", "cta"];

    // ── Professional services — credentials + Q&A ────────────────────
    case "professional-legal-financial":
      // Legal/financial: trust (credentials) → practice areas →
      // people (the attorney IS the brand) → FAQ → reviews → CTA.
      return ["hero", "trust", "services", "team-grid", "faq", "reviews", "cta"];

    case "professional-creative-tech":
      // Creative agencies: portfolio (services) → people → FAQ →
      // story → reviews. Trust strip dropped (work speaks).
      return ["hero", "services", "team-grid", "faq", "about-block", "reviews", "cta"];

    // ── Real estate ──────────────────────────────────────────────────
    case "real-estate":
      // Real estate: where they sell first, then who sells, then
      // listings (services), then reviews. No about-block (team-grid
      // does that work).
      return ["hero", "service-area", "team-grid", "services", "reviews", "cta"];

    // ── Retail / editorial niches — story-led, distinct ordering ─────
    case "vintage-antiques-thrift":
      // Vintage: story-first (curation philosophy) → what we found
      // (services) → reviews → where to visit.
      return ["hero", "about-block", "services", "reviews", "service-area", "cta"];

    case "home-decor-retail":
      // Home decor: products front and center. Services → story →
      // reviews → showroom location.
      return ["hero", "services", "about-block", "reviews", "service-area", "cta"];

    case "boutique-gift-retail":
      // Boutique: services + reviews tightly paired (looks + people
      // loving them), then story, then where to find them.
      return ["hero", "services", "reviews", "about-block", "service-area", "cta"];

    // ── Events ───────────────────────────────────────────────────────
    case "event-services":
      // Event styling: portfolio (services) → reviews (proof) →
      // story → team (creatives behind it). Last 2 invert retail.
      return ["hero", "services", "reviews", "about-block", "team-grid", "cta"];

    // ── Entertainment ───────────────────────────────────────────────
    case "entertainment-venues":
      // Bowling, arcades, escape rooms, comedy clubs. Visitors come
      // TO the venue — service-area early so they know it's local.
      // Then experiences (services) → menu/food if offered (we don't
      // populate menu here, but the slot is open) → reviews → about.
      return ["hero", "service-area", "services", "reviews", "about-block", "cta"];

    case "entertainment-services":
      // DJs, bands, magicians, kids entertainers. Performer-led —
      // the TEAM (act) is the brand. Portfolio (services) →
      // performers (team) → reviews → story → service-area (where
      // they travel) → cta.
      return ["hero", "services", "team-grid", "reviews", "about-block", "service-area", "cta"];

    default:
      return ["hero", "trust", "services", "service-area", "reviews", "cta"];
  }
}

/**
 * Design family — a higher-level grouping than NicheKey that drives
 * visual rhythm via per-family CSS overrides on global.css. Each
 * family has its own type scale, eyebrow style, section padding,
 * card geometry, shadow depth, and motion profile. Two niches in the
 * same family ship with the same visual personality (which is fine —
 * a salon and a spa SHOULD feel like related cousins), but two
 * niches in DIFFERENT families read as categorically different
 * templates.
 *
 * Why 7 not 20: maintaining 20 distinct visual systems is a code-mass
 * problem (20 × ~150 lines of overrides). 7 families balance
 * variety with maintainability — and the within-family color/font/
 * variant rotation already varies enough that two salons won't be
 * indistinguishable.
 *
 * Templates read this via the `data-design-family` body attribute
 * (see Base.astro) and global.css [data-design-family="..."] rules.
 */
export type DesignFamily =
  | "editorial-print"     // vintage, retail, boutique, real-estate
  | "menu-magazine"       // food (restaurant, cafe, catering)
  | "counsel-corporate"   // legal, financial
  | "creative-modern"     // creative-tech agencies
  | "spa-luxe"            // beauty, spa, wellness
  | "bold-utility"        // mechanical trades, auto, cleaning, roofing, landscaping, construction
  | "vibrant-event"       // event services, pet, fitness
  | "entertainment-stage"; // bowling, arcades, DJs, bands, comedy, music venues

export function pickDesignFamily(niche: NicheKey): DesignFamily {
  switch (niche) {
    // Editorial — print-feel, generous whitespace, soft radii
    case "vintage-antiques-thrift":
    case "home-decor-retail":
    case "boutique-gift-retail":
    case "real-estate":
      return "editorial-print";

    // Menu-magazine — terracotta + cream, leader-dot type
    case "food-restaurants":
    case "food-cafe-bakery":
    case "food-catering-events":
      return "menu-magazine";

    // Counsel-corporate — tight radii, classical serif, restrained
    case "professional-legal-financial":
      return "counsel-corporate";

    // Creative-modern — bold sans, animated mesh, snappy motion
    case "professional-creative-tech":
      return "creative-modern";

    // Spa-luxe — generous radii, blush wash, slow fade-in
    case "beauty-hair-nails":
    case "spa-massage-wellness":
      return "spa-luxe";

    // Bold-utility — strong tracking, structured grid, snappy
    case "home-services-trades":
    case "automotive":
    case "cleaning-restoration":
    case "roofing-exterior":
    case "landscaping-outdoor":
    case "construction-remodel":
      return "bold-utility";

    // Vibrant-event — energetic, friendly, larger radii
    case "event-services":
    case "pet-services":
    case "fitness-gyms":
      return "vibrant-event";

    // Entertainment-stage — performer / venue presence. Distinct from
    // vibrant-event (pets, gyms) because the brand needs more
    // gravitas — bowling alley shouldn't look like a vet clinic.
    case "entertainment-venues":
    case "entertainment-services":
      return "entertainment-stage";

    default:
      return "bold-utility";
  }
}

/**
 * Niche-aware copy headers for the services section. Two leads in
 * different niches shouldn't both open with "What we do / Crafted for
 * {city}" — the eyebrow + headline pair is one of the strongest
 * categorical signals on the page.
 *
 * Headline takes a {city} placeholder; stage-3 substitutes the
 * city,state string at render time.
 */
export interface ServicesHeader {
  eyebrow: string;
  headline_template: string;
}

export function pickServicesHeader(niche: NicheKey): ServicesHeader {
  switch (niche) {
    case "food-restaurants":
    case "food-cafe-bakery":
      return { eyebrow: "On the menu", headline_template: "Made for {city}" };
    case "food-catering-events":
      return { eyebrow: "What we cater", headline_template: "Events across {city}" };
    case "professional-legal-financial":
      return { eyebrow: "Practice areas", headline_template: "Counsel for {city}" };
    case "professional-creative-tech":
      return { eyebrow: "What we ship", headline_template: "Built in {city}" };
    case "real-estate":
      return { eyebrow: "How we work", headline_template: "Listings across {city}" };
    case "vintage-antiques-thrift":
      return { eyebrow: "What we curate", headline_template: "Found in {city}" };
    case "home-decor-retail":
    case "boutique-gift-retail":
      return { eyebrow: "What we carry", headline_template: "Picked for {city}" };
    case "event-services":
      return { eyebrow: "What we style", headline_template: "Celebrated in {city}" };
    case "beauty-hair-nails":
    case "spa-massage-wellness":
      return { eyebrow: "Treatments", headline_template: "Made for {city}" };
    case "fitness-gyms":
      return { eyebrow: "Programs", headline_template: "Training in {city}" };
    case "pet-services":
      return { eyebrow: "What we offer", headline_template: "For {city} pets" };
    case "automotive":
      return { eyebrow: "Services", headline_template: "Driving in {city}" };
    case "entertainment-venues":
      return { eyebrow: "What's on", headline_template: "Experiences in {city}" };
    case "entertainment-services":
      return { eyebrow: "Acts & sets", headline_template: "Booking across {city}" };
    case "cleaning-restoration":
    case "landscaping-outdoor":
    case "roofing-exterior":
    case "construction-remodel":
    case "home-services-trades":
    default:
      return { eyebrow: "What we do", headline_template: "Crafted for {city}" };
  }
}

/**
 * Force a hero variant choice to be compatible with the actual photo count.
 * Used by stage-3-generate.ts AFTER pickVariants OR Gemini-supplied variants
 * have been chosen, so the template never tries to render parallax-photos
 * for a lead with 0 photos.
 */
export function clampHeroToPhotos(
  hero: Variants["hero"],
  photoCount: number,
): Variants["hero"] {
  const photosThatNeedImages: Variants["hero"][] = [
    "parallax-photos",
    "full-bleed-photo",
    "split-with-stats",
    "editorial-split",
  ];
  if (photoCount === 0 && photosThatNeedImages.includes(hero)) return "animated-gradient";
  if (photoCount < 3 && hero === "parallax-photos") return "full-bleed-photo";
  return hero;
}

/**
 * Force the service_area variant to one that fits the lead's real context.
 *
 * Gemini's strategy pass sometimes picks `radius-card` for a fixed-shop
 * business because "concentric rings" reads as visually distinctive — but
 * the variant's whole copy premise is "we come to you", which is wrong
 * for a vintage store / restaurant / salon that operates from one address.
 *
 * Similarly, `map-pin-cards` only earns its keep when there are enough
 * areas to fill the numbered pin rail — under 3 areas it looks bloated.
 *
 * Called from stage-3-generate.ts AFTER enforceDiversity, so it always
 * has the final say.
 */
export function clampServiceAreaToContext(
  sa: Variants["service_area"],
  ctx: { is_service_area_only: boolean; areas_count: number },
): Variants["service_area"] {
  // radius-card needs the "we travel TO you" premise. A fixed-address
  // business with a pinnable shop should never get this variant.
  if (sa === "radius-card" && !ctx.is_service_area_only) {
    return ctx.areas_count >= 5 ? "map-pin-cards" : "map-editorial";
  }
  // map-pin-cards is calibrated for 5+ areas (6 in the rail + overflow
  // pills). Under 3 it visually under-fills the rail.
  if (sa === "map-pin-cards" && ctx.areas_count < 3) {
    return "map-editorial";
  }
  // legacy styled-list passes through — it's only kept for unmigrated
  // data.json blobs.
  return sa;
}
