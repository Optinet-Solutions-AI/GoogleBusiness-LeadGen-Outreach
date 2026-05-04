/**
 * niche.ts — Map a free-form Google Maps category to one of N curated buckets.
 *
 * Inputs:  category string (e.g. "Plumber", "Estate sale company", null)
 * Outputs: niche bucket key (drives stock photos, palette nuance, picker rules)
 * Used by: lib/data/stock-photos.ts, lib/picker.ts, lib/pipeline/stage-3-generate.ts
 *
 * Why bucket: a free-form category lookup table would explode to hundreds of
 * rows; bucketing by industry vibe gives us 8 cohesive design directions
 * (palette, photo set, layout choices) that cover ~95% of small-business
 * categories Google returns.
 *
 * Adding a niche: extend NicheKey, add a row to MATCHERS, populate
 * stock-photos.ts. Order in MATCHERS matters — first regex match wins,
 * so put more-specific niches above broader ones (e.g. real-estate
 * before professional-services).
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

interface NicheMatcher {
  niche: NicheKey;
  pattern: RegExp;
}

// Order matters: most specific first. Default is home-services because the
// trades stock pool is broadly applicable to "service business with truck."
const MATCHERS: NicheMatcher[] = [
  // Home goods / vintage / boutique. \B at the end is intentional — "Estate
  // Sales" (plural) was failing the word-boundary check at the trailing s;
  // dropping the trailing \b lets both "estate sale" and "estate sales"
  // hit. Same for "antiques", "consignments", "thrifts".
  {
    niche: "home-goods-vintage",
    pattern: /\b(estate ?sale|vintage|antique|thrift|consign|home ?good|furniture|boutique|florist|gift|interior|home ?decor|secondhand)/i,
  },
  // Real estate (must come before professional-services so realtors don't get gold/navy)
  {
    niche: "real-estate",
    pattern: /\b(real ?estate|realtor|broker|property ?management|leasing|mls|home ?builder)\b/i,
  },
  // Beauty / wellness
  {
    niche: "beauty-wellness",
    pattern: /\b(salon|spa|barber|nail|lash|brow|makeup|massage|estheti|skin|wax|hair|wellness|aestheti|tan)\b/i,
  },
  // Food & beverage
  {
    niche: "food-beverage",
    pattern: /\b(restaurant|cafe|coffee|bakery|brewery|deli|pizzeria|food|catering|diner|tea|juice|bar ?and ?grill|taco|sushi|sandwich|donut|ice ?cream)\b/i,
  },
  // Professional services
  {
    niche: "professional-services",
    pattern: /\b(lawyer|attorney|law ?firm|accountant|cpa|consult|financial|insurance|tax|notary|marketing ?agency|advertis|architect|engineer)\b/i,
  },
  // Fitness / pet
  {
    niche: "fitness-pet",
    pattern: /\b(gym|fitness|yoga|pilates|crossfit|martial ?art|personal ?train|pet|vet|veter|grooming|kennel|dog|cat)\b/i,
  },
  // Landscaping / construction (must come before home-services so "roofer" doesn't get plumbing photos)
  {
    niche: "landscaping-construction",
    pattern: /\b(landscap|lawn|garden|tree|arborist|roof|gutter|siding|concrete|paving|paint|fenc|deck|hardscape|construct|remodel|carpent|excavat|window|stucco)\b/i,
  },
  // Home services (catch-all for trades)
  {
    niche: "home-services",
    pattern: /\b(plumb|hvac|heating|cooling|air ?condition|electric|locksmith|garage ?door|septic|carpet ?clean|pest|appliance|handy|drywall|movers?|junk ?removal|cleaning|disaster|water ?damage|restoration)\b/i,
  },
];

const DEFAULT_NICHE: NicheKey = "home-services";

/**
 * Classify a free-form Google Maps category into one of NICHE_KEYS.
 * Falls back to "home-services" (the broadest trades pool) when nothing matches.
 *
 * Two real-world quirks this handles:
 *   1. Google returns underscored slugs like "home_goods_store" (not "home
 *      goods store") — those break \b boundaries with the underscore. We
 *      normalize underscores → spaces before matching.
 *   2. Google's category for a business is often imprecise. Mimi and Me
 *      Estate Sales has category="consultant"; Mike's Roofing has
 *      category="business" sometimes. The business NAME usually carries the
 *      truth. We classify against `category + " " + business_name` so the
 *      name keywords vote too — and since MATCHERS are ordered most-specific
 *      first, a name-driven match beats a generic category match.
 *
 * Examples:
 *   "Plumber"                                    → "home-services"
 *   "home_goods_store"                           → "home-goods-vintage"
 *   "consultant" + "Mimi and Me Estate Sales"    → "home-goods-vintage"
 *   "Hair salon"                                 → "beauty-wellness"
 *   null / empty                                 → "home-services"
 */
export function classifyNiche(
  category: string | null | undefined,
  businessName?: string | null,
): NicheKey {
  const haystack = [category ?? "", businessName ?? ""]
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/_/g, " ");           // home_goods_store → home goods store
  if (!haystack) return DEFAULT_NICHE;
  for (const { niche, pattern } of MATCHERS) {
    if (pattern.test(haystack)) return niche;
  }
  return DEFAULT_NICHE;
}
