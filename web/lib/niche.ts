/**
 * niche.ts — Map a free-form Google Maps category to one of N curated buckets.
 *
 * Inputs:  category string (e.g. "Plumber", "Estate sale company", null)
 * Outputs: niche bucket key (drives stock photos, palette nuance, picker rules)
 * Used by: lib/data/stock-photos.ts, lib/picker.ts, lib/pipeline/stage-3-generate.ts
 *
 * Why bucket: a free-form category lookup table would explode to hundreds of
 * rows; bucketing by industry vibe gives us 20 cohesive design directions
 * that cover ~95% of small-business categories Google returns.
 *
 * Adding a niche: extend NicheKey, add a row to MATCHERS, populate
 * stock-photos.ts. Order in MATCHERS matters — first regex match wins,
 * so put more-specific niches above broader ones (e.g. event-services
 * before home-decor-retail; cleaning-restoration before home-services-trades).
 */

export type NicheKey =
  | "home-services-trades"
  | "cleaning-restoration"
  | "roofing-exterior"
  | "landscaping-outdoor"
  | "construction-remodel"
  | "automotive"
  | "beauty-hair-nails"
  | "spa-massage-wellness"
  | "chiropractic"
  | "dental"
  | "fitness-gyms"
  | "pet-services"
  | "food-restaurants"
  | "food-cafe-bakery"
  | "food-catering-events"
  | "professional-legal-financial"
  | "professional-creative-tech"
  | "real-estate"
  | "vintage-antiques-thrift"
  | "home-decor-retail"
  | "event-services"
  | "boutique-gift-retail"
  | "entertainment-venues"
  | "entertainment-services";

interface NicheMatcher {
  niche: NicheKey;
  pattern: RegExp;
}

// Order matters: most specific first. Default is home-services-trades because
// the trades stock pool is broadly applicable to "service business with truck."
const MATCHERS: NicheMatcher[] = [
  // Event services first — balloon/florist/event styling must not collide
  // with home-decor-retail or vintage-antiques.
  {
    niche: "event-services",
    pattern: /\b(balloon|florist|flower ?shop|event ?stylist|event ?styling|wedding ?planner|wedding ?stylist|party ?planner|event ?decor|event ?rental|decorator)\b/i,
  },
  // Entertainment-services — performer / talent businesses. DJs, bands,
  // magicians, MCs, kids party entertainers, inflatable rentals. These
  // are PEOPLE who travel to an event, distinct from a fixed venue.
  // Must come before entertainment-venues so "DJ at the wedding venue"
  // classifies as a DJ, not the venue.
  {
    niche: "entertainment-services",
    pattern: /\b(dj|disc ?jockey|band\b|cover ?band|musician|magician|emcee|\bmc\b|kids ?party|children'?s ?entertainer|bounce ?house|inflatable ?rental|party ?entertain|live ?act|wedding ?dj|mobile ?dj|wedding ?band)\b/i,
  },
  // Entertainment-venues — fixed-location experience businesses. Bowling,
  // arcade, escape room, mini-golf, comedy club, theater, music venue,
  // karaoke, banquet hall, laser tag, axe-throwing. Visitors come TO
  // the location.
  {
    niche: "entertainment-venues",
    pattern: /\b(bowling|arcade|escape ?room|mini ?golf|laser ?tag|axe ?throw|comedy ?club|theatre|theater|playhouse|music ?venue|live ?music|karaoke|banquet ?hall|trampoline ?park|family ?entertain|amusement)\b/i,
  },
  // Vintage / antique / thrift / consignment / estate-sale
  {
    niche: "vintage-antiques-thrift",
    pattern: /\b(estate ?sale|vintage|antique|thrift|consign|secondhand|pawn)/i,
  },
  // Home decor retail — furniture / interior / decor / lighting / hardware
  {
    niche: "home-decor-retail",
    pattern: /\b(furniture|home ?good|interior ?design|interior ?decor|home ?decor|lighting ?store|hardware ?store|rugs?|tile ?store)/i,
  },
  // Boutique / gift / jewelry / accessory / clothing retail
  {
    niche: "boutique-gift-retail",
    pattern: /\b(boutique|gift ?shop|jewelry|jeweler|accessor|clothing ?store|apparel|shoe ?store)/i,
  },
  // Real estate (must come before professional-legal-financial)
  {
    niche: "real-estate",
    pattern: /\b(real ?estate|realtor|broker|property ?management|leasing|mls|home ?builder)\b/i,
  },
  // Beauty / hair / nails
  {
    niche: "beauty-hair-nails",
    pattern: /\b(salon|barber|nail|lash|brow|makeup|hair|wax|tan|aestheti|estheti)\b/i,
  },
  // Chiropractic + dental are FOCUS niches with NO appropriate stock pool of
  // their own (plumbing and luxury-spa-pool stock both look wrong on them).
  // Give them dedicated keys with EMPTY pools so the renderer shows ONLY the
  // business's real photos — never mismatched stock. Must come before the spa
  // rule (which also matches "wellness"-ish words). `chiropract\w*` so
  // "chiropractor"/"chiropractic" match (a trailing \b failed mid-word).
  {
    niche: "chiropractic",
    pattern: /\b(chiropract\w*|spine|spinal|sports ?med|physical ?therap|physiotherap|rehab)\b/i,
  },
  {
    niche: "dental",
    pattern: /\b(dent(?:al|ist|istry)|orthodont\w*|endodont\w*|periodont\w*|prosthodont\w*|oral ?surg\w*|\bdds\b|\bdmd\b)\b/i,
  },
  // Spa / massage / wellness
  {
    niche: "spa-massage-wellness",
    pattern: /\b(spa|massage|sauna|wellness|holistic|reflex|acupuncture)\b/i,
  },
  // Fitness / gyms
  {
    niche: "fitness-gyms",
    pattern: /\b(gym|fitness|crossfit|martial ?art|personal ?train|yoga|pilates|boxing|cycle ?studio)\b/i,
  },
  // Pet services (vet, grooming, kennel, dog walker)
  {
    niche: "pet-services",
    pattern: /\b(pet|vet|veter|grooming|kennel|dog ?walk|dog ?daycare|cattery|dog ?train)\b/i,
  },
  // Food: catering / events (must come before food-restaurants so "catering" wins)
  {
    niche: "food-catering-events",
    pattern: /\b(catering|caterer|food ?truck|private ?chef|event ?catering)\b/i,
  },
  // Food: cafe / bakery / sweets
  {
    niche: "food-cafe-bakery",
    pattern: /\b(cafe|coffee|bakery|donut|ice ?cream|tea ?house|juice ?bar|dessert|patisserie|gelato)\b/i,
  },
  // Food: full-service restaurants
  {
    niche: "food-restaurants",
    pattern: /\b(restaurant|diner|pizzeria|sushi|taco|sandwich|bar ?and ?grill|gastropub|steakhouse|brewery|deli)\b/i,
  },
  // Automotive (must come before home-services-trades so "shop" generics fall through)
  {
    niche: "automotive",
    pattern: /\b(auto ?repair|mechanic|body ?shop|oil ?change|tire ?shop|car ?dealer|auto ?detail|brake ?shop|transmission|auto ?glass)\b/i,
  },
  // Professional: creative / tech / marketing / photo / video
  {
    niche: "professional-creative-tech",
    pattern: /\b(marketing ?agency|advertis|design ?agency|web ?design|web ?develop|software|app ?develop|photograph|videograph|video ?production|graphic ?design|branding ?agency|studio)\b/i,
  },
  // Professional: legal / financial / accounting / insurance
  {
    niche: "professional-legal-financial",
    pattern: /\b(lawyer|attorney|law ?firm|accountant|cpa|financial|insurance|tax|notary|architect|engineer|consult)\b/i,
  },
  // Roofing / exterior trades (must come before landscaping-outdoor + before home-services-trades)
  {
    niche: "roofing-exterior",
    pattern: /\b(roof|gutter|siding|stucco|exterior ?paint|window ?install)/i,
  },
  // Landscaping / outdoor work (must come before construction-remodel)
  {
    niche: "landscaping-outdoor",
    pattern: /\b(landscap|lawn|garden|tree|arborist|paving|concrete|deck|fenc|hardscape|sprinkler|irrigation|pool ?clean|pool ?service)/i,
  },
  // Construction / general remodel / carpentry
  {
    niche: "construction-remodel",
    pattern: /\b(construct|remodel|carpent|excavat|general ?contractor|home ?builder|kitchen ?remodel|bath ?remodel)/i,
  },
  // Cleaning / restoration / movers / junk removal
  {
    niche: "cleaning-restoration",
    pattern: /\b(carpet ?clean|water ?damage|disaster|restoration|junk ?removal|movers?|moving ?company|cleaning ?service|maid ?service|pressure ?wash|window ?cleaning)/i,
  },
  // Home services trades (catch-all for plumbing/HVAC/electric/handy)
  {
    niche: "home-services-trades",
    pattern: /\b(plumb|hvac|heating|cooling|air ?condition|electric|locksmith|garage ?door|septic|pest|appliance ?repair|handy|drywall)\b/i,
  },
];

const DEFAULT_NICHE: NicheKey = "home-services-trades";

/**
 * Classify a free-form Google Maps category into one of NICHE_KEYS.
 * Falls back to "home-services-trades" (the broadest trades pool) when nothing matches.
 *
 * Two real-world quirks this handles:
 *   1. Google returns underscored slugs like "home_goods_store" (not "home
 *      goods store") — those break \b boundaries with the underscore. We
 *      normalize underscores → spaces before matching.
 *   2. Google's category for a business is often imprecise. Mimi and Me
 *      Estate Sales has category="consultant"; balloon-styling businesses
 *      get "home_goods_store". The business NAME usually carries the truth.
 *      We classify against `category + " " + business_name` so the name
 *      keywords vote too — and since MATCHERS are ordered most-specific
 *      first, a name-driven match beats a generic category match.
 *
 * Examples:
 *   "Plumber"                                      → "home-services-trades"
 *   "consultant" + "Mimi and Me Estate Sales"      → "vintage-antiques-thrift"
 *   "home_goods_store" + "The Little Things Balloon Garlands" → "event-services"
 *   null / empty                                   → "home-services-trades"
 */
export function classifyNiche(
  category: string | null | undefined,
  businessName?: string | null,
): NicheKey {
  const haystack = [category ?? "", businessName ?? ""]
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/_/g, " ");
  if (!haystack) return DEFAULT_NICHE;
  for (const { niche, pattern } of MATCHERS) {
    if (pattern.test(haystack)) return niche;
  }
  return DEFAULT_NICHE;
}
