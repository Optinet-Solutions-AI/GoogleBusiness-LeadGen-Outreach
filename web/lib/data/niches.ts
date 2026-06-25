/**
 * data/niches.ts — curated niche presets for the New Batch modal.
 *
 * Two axes per niche:
 *   - category: WHAT the business does (Trades, Pets, Personal Services…).
 *               Used for grouping in the dropdown so the user can browse.
 *   - yield:    HOW LIKELY a business in this niche skips having a real
 *               website (high / medium / low). Drawn from observed
 *               has_website rejection rates on real batches.
 *
 * Free-form typing is still allowed — these are suggestions, not a whitelist.
 */

export type NicheYield = "high" | "medium" | "low";

export type NicheCategory =
  | "Personal Services"
  | "Events & Hospitality"
  | "Pets"
  | "Auto"
  | "Home & Outdoor"
  | "Trades"
  | "Real Estate & Sales"
  | "Beauty & Wellness"
  | "Food"
  | "Professional";

export interface NicheOption {
  value: string;
  category: NicheCategory;
  yield: NicheYield;
  hint: string;
}

export const NICHE_OPTIONS: NicheOption[] = [
  // ── Personal Services ───────────────────────────────────────────
  { value: "personal trainer",        category: "Personal Services", yield: "high",   hint: "Independents use Linktree at most" },
  { value: "independent tutor",       category: "Personal Services", yield: "high",   hint: "Word-of-mouth driven" },
  { value: "music teacher",           category: "Personal Services", yield: "high",   hint: "Independent piano/guitar teachers" },
  { value: "babysitter",              category: "Personal Services", yield: "high",   hint: "Independent, not agency" },
  { value: "personal chef",           category: "Personal Services", yield: "high",   hint: "In-home, very small operators" },
  { value: "mobile notary",           category: "Personal Services", yield: "high",   hint: "Phone-driven, especially tier-3" },
  { value: "life coach",              category: "Personal Services", yield: "medium", hint: "Often Instagram-only" },

  // ── Events & Hospitality ────────────────────────────────────────
  { value: "bartender for hire",      category: "Events & Hospitality", yield: "high",   hint: "Almost all Instagram-only" },
  { value: "event photographer",      category: "Events & Hospitality", yield: "medium", hint: "Some still IG-only" },
  { value: "wedding officiant",       category: "Events & Hospitality", yield: "medium", hint: "Very local, low digital" },
  { value: "balloon artist",          category: "Events & Hospitality", yield: "high",   hint: "Almost always IG/FB only" },
  { value: "dj for hire",             category: "Events & Hospitality", yield: "medium", hint: "Mixed — some have basic sites" },

  // ── Pets ────────────────────────────────────────────────────────
  { value: "dog walker",              category: "Pets", yield: "high",   hint: "Independent, not Wag/Rover" },
  { value: "pet sitter",              category: "Pets", yield: "high",   hint: "Independent, very local" },
  { value: "mobile dog grooming",     category: "Pets", yield: "medium", hint: "Solo operators, varies by city" },
  { value: "dog trainer",             category: "Pets", yield: "medium", hint: "Independent trainers" },

  // ── Auto ────────────────────────────────────────────────────────
  { value: "mobile car detailing",    category: "Auto", yield: "medium", hint: "Some still Facebook-only" },
  { value: "mobile mechanic",         category: "Auto", yield: "medium", hint: "Better in smaller markets" },
  { value: "auto window tinting",     category: "Auto", yield: "medium", hint: "Mixed digital adoption" },

  // ── Home & Outdoor ──────────────────────────────────────────────
  { value: "junk removal",            category: "Home & Outdoor", yield: "medium", hint: "Mom-and-pop ops in tier-3" },
  { value: "pressure washing",        category: "Home & Outdoor", yield: "medium", hint: "Saturated in TX, better in AL/MS" },
  { value: "lawn care",               category: "Home & Outdoor", yield: "medium", hint: "Saturated near metros" },
  { value: "pool cleaning",           category: "Home & Outdoor", yield: "medium", hint: "Many tiny route operators" },
  { value: "gutter cleaning",         category: "Home & Outdoor", yield: "medium", hint: "Seasonal solo operators" },
  { value: "christmas light installation", category: "Home & Outdoor", yield: "medium", hint: "Seasonal, often phone-only" },
  { value: "snow plowing",            category: "Home & Outdoor", yield: "medium", hint: "Seasonal, cold regions" },
  { value: "house cleaning",          category: "Home & Outdoor", yield: "medium", hint: "Independent cleaners" },

  // ── Trades ──────────────────────────────────────────────────────
  { value: "handyman",                category: "Trades", yield: "medium", hint: "Saturated in major metros" },
  { value: "plumber",                 category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "electrician",             category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "hvac",                    category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "roofer",                  category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "painter",                 category: "Trades", yield: "low",    hint: "Saturated digitally" },
  { value: "landscaping",             category: "Trades", yield: "low",    hint: "Saturated digitally" },

  // ── Real Estate & Sales ─────────────────────────────────────────
  { value: "estate sale company",     category: "Real Estate & Sales", yield: "high",   hint: "Phone + FB driven, very low site adoption" },
  { value: "auctioneer",              category: "Real Estate & Sales", yield: "medium", hint: "Many independents, mixed digital" },

  // ── Food ────────────────────────────────────────────────────────
  { value: "mobile food vendor",      category: "Food", yield: "high",   hint: "Food trucks/carts; ~30-40% no site" },
  { value: "food truck",              category: "Food", yield: "high",   hint: "Often Instagram-only" },
  { value: "caterer",                 category: "Food", yield: "medium", hint: "Independent caterers" },
  { value: "restaurant",              category: "Food", yield: "low",    hint: "Yelp + delivery apps cover them" },

  // ── Beauty & Wellness ───────────────────────────────────────────
  { value: "salon",                   category: "Beauty & Wellness", yield: "low",    hint: "Booksy / Square / Vagaro dominate" },
  { value: "massage therapist",       category: "Beauty & Wellness", yield: "medium", hint: "Independent therapists" },
  { value: "nail technician",         category: "Beauty & Wellness", yield: "medium", hint: "Independent, often IG-only" },

  // ── Professional ────────────────────────────────────────────────
  { value: "lawyer",                  category: "Professional", yield: "low", hint: "Almost universally websited" },
  { value: "accountant",              category: "Professional", yield: "low", hint: "Almost universally websited" },
];

export const NICHE_CATEGORIES: NicheCategory[] = [
  "Personal Services",
  "Events & Hospitality",
  "Pets",
  "Auto",
  "Home & Outdoor",
  "Trades",
  "Real Estate & Sales",
  "Food",
  "Beauty & Wellness",
  "Professional",
];

/**
 * Maps each niche category to the template slug we use when building a
 * website for that lead (stage 3). The template determines copy tone,
 * layout, and section emphasis (e.g. trades emphasize service area +
 * emergency call-out; food emphasizes menu + hours).
 *
 * Used by NewBatchModal to auto-sync the Template select when the
 * operator picks a niche, so picking "estate sale company" doesn't
 * leave them with a Trades template by accident.
 */
// All categories route to 'premium-trades' for now. Niche-specific templates
// (food-beverage, beauty-wellness, professional-services) don't exist yet —
// stage-3 used to fall back to the legacy 'trades' template when it didn't
// find a directory, which gave non-trades niches an embarrassingly basic
// demo. Until per-niche templates are built, premium-trades is the best
// generic option for any service business. Replace the slug below as soon
// as a niche-specific template ships.
export const CATEGORY_TO_TEMPLATE: Record<NicheCategory, string> = {
  "Trades":              "premium-trades",
  "Home & Outdoor":      "premium-trades",
  "Auto":                "premium-trades",
  "Food":                "premium-trades",
  "Beauty & Wellness":   "premium-trades",
  "Professional":        "premium-trades",
  "Personal Services":   "premium-trades",
  "Events & Hospitality": "premium-trades",
  "Pets":                "premium-trades",
  "Real Estate & Sales": "premium-trades",
};

/** Default template for niches we don't have curated in NICHE_OPTIONS. */
const DEFAULT_TEMPLATE = "premium-trades";

/**
 * The only niches the WEBSITE BUILDER runs for. These five map 1:1 to the
 * single-file HTML templates in templates/*-site/. Any other niche can still
 * be scraped + enriched (and used for email/SMS outreach), but stage 3 won't
 * build a demo site for it. Gate lives in lib/pipeline/build-lead.ts +
 * app/api/leads/[id]/build/route.ts. See memory project_niche_html_templates.
 */
export const FOCUS_TEMPLATE_SLUGS = [
  "trades-site",
  "dental-site",
  "chiropractic-site",
  "restaurant-site",
  "auto-site",
] as const;

/** Human label for the supported builder niches (operator-facing messages). */
export const SUPPORTED_BUILD_NICHES_LABEL =
  "Trades, Dental, Chiropractic, Restaurants, Auto Shops";

/** True only when `templateSlug` is one of the five focus HTML templates. */
export function isWebsiteBuildable(templateSlug: string | null | undefined): boolean {
  return (
    !!templateSlug &&
    (FOCUS_TEMPLATE_SLUGS as readonly string[]).includes(templateSlug)
  );
}

/**
 * The five focus niches each ship a dedicated single-file HTML template
 * (token-swap render in stage 3 — see lib/pipeline/html-template-render.ts).
 * Keyword-matched against the free-typed niche so any phrasing of the niche
 * ("dentist", "family dental", "auto repair shop", "italian restaurant")
 * resolves to the right design. Order matters — first match wins.
 */
// Patterns use a leading \b but generally NO trailing \b so stems match
// inflected forms ("plumb" → plumber/plumbing, "dent(al|ist)" → dentistry).
// trades-site is intentionally scoped to core mechanical/handyman trades —
// roofers, painters, and landscapers route to premium-trades, whose Gemini
// pass writes niche-specific copy and pulls niche photos (a better demo than
// a plumbing-flavored static page).
const FOCUS_TEMPLATE_RULES: Array<{ slug: string; pattern: RegExp }> = [
  { slug: "dental-site", pattern: /\b(dent(al|ist)|orthodont|endodont|periodont|dds|dmd)/i },
  { slug: "chiropractic-site", pattern: /\bchiro/i },
  {
    slug: "restaurant-site",
    pattern: /\b(restaurant|diner|bistro|eatery|cafe|café|grill|pizz|steakhouse|trattoria|brunch|gastropub|delicatessen|deli\b|taqueria|brasserie|noodle|ramen|sushi)/i,
  },
  {
    slug: "auto-site",
    pattern: /\bauto|\bcars?\b|\bmechanic|body\s?shop|\btires?\b|\bbrake|transmission|oil\s?change|detailing|muffler|collision|\blube\b/i,
  },
  {
    slug: "trades-site",
    pattern: /\bplumb|\belectric|\bhvac\b|\bheating|\bcooling|air\s?condition|\bhandyman|\bcontractor|\bremodel|\brenovat|water\s?heater|\bfurnace|drywall|\bseptic|\btrades?\b/i,
  },
];

/**
 * Derive the template slug from a free-typed niche. Used server-side by
 * the batches POST route so the operator never has to pick a template —
 * picking the wrong slug would build a broken site at stage 3.
 *
 * Focus niches (trades/dental/chiropractic/restaurant/auto) keyword-match to
 * their dedicated HTML templates first. Everything else matches NICHE_OPTIONS
 * by case-insensitive exact value and routes via CATEGORY_TO_TEMPLATE; unknown
 * niches fall back to DEFAULT_TEMPLATE (premium-trades, the Astro generic).
 */
export function templateForNiche(niche: string): string {
  const trimmed = niche.trim().toLowerCase();
  if (!trimmed) return DEFAULT_TEMPLATE;
  for (const { slug, pattern } of FOCUS_TEMPLATE_RULES) {
    if (pattern.test(trimmed)) return slug;
  }
  const matched = NICHE_OPTIONS.find((n) => n.value.toLowerCase() === trimmed);
  if (!matched) return DEFAULT_TEMPLATE;
  return CATEGORY_TO_TEMPLATE[matched.category] ?? DEFAULT_TEMPLATE;
}

/**
 * Resolve the FOCUS template a lead should build with, tolerating legacy /
 * non-focus batch slugs. Older batches stored the pre-HTML slug ("trades",
 * "premium-trades") which `isWebsiteBuildable` rejects, so a clearly-buildable
 * lead (e.g. an HVAC contractor) couldn't build. We:
 *   1. use the batch slug as-is when it's already a focus slug;
 *   2. otherwise derive a focus template from the lead's own category (most
 *      specific), then the batch niche, accepting only a focus result;
 *   3. else null → genuinely not buildable (stays available for outreach).
 * Used by build-gate, build-lead, the regenerate job, and the lead page.
 */
export function resolveBuildTemplate(opts: {
  batchTemplateSlug?: string | null;
  category?: string | null;
  niche?: string | null;
}): string | null {
  if (isWebsiteBuildable(opts.batchTemplateSlug)) return opts.batchTemplateSlug ?? null;
  for (const src of [opts.category, opts.niche]) {
    if (src && src.trim()) {
      const slug = templateForNiche(src);
      if (isWebsiteBuildable(slug)) return slug;
    }
  }
  return null;
}

export const YIELD_LABEL: Record<NicheYield, string> = {
  high: "High yield",
  medium: "Medium",
  low: "Low (skip)",
};

export const YIELD_DOT: Record<NicheYield, string> = {
  high: "bg-positive",
  medium: "bg-warning",
  low: "bg-urgent/80",
};
