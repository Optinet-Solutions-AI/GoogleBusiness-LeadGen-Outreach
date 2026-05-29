/**
 * stock-photos.ts — Niche-keyed Unsplash pools for premium stock imagery.
 *
 * Inputs:  niche key (from lib/niche.classifyNiche) — falls back to template_slug
 * Outputs: array of high-quality Unsplash URLs ready to <img src>
 * Used by: lib/pipeline/stage-3-generate.ts photo composition step
 *
 * Why niche-keyed: a free-form category lookup table would explode to hundreds of
 * rows; bucketing by industry vibe gives us 20 cohesive design directions
 * that cover ~95% of small-business categories Google returns.
 *
 * Composition policy (see stage-3-generate.ts):
 *   slots 0–1   → ALWAYS pulled from this pool (premium first-impression shots)
 *   slots 2–N   → real Google photos preferred; fall back to this pool
 *
 * URL format: every entry uses ?w=1600&auto=format&fit=crop&q=80 so Unsplash
 * delivers AVIF/WebP at the requested width. Friendly to PageSpeed.
 *
 * Adding more: only commit IDs you have personally verified resolve via curl
 * against images.unsplash.com. Do not invent photo IDs — Unsplash 404s become
 * broken <img> on every shipped site.
 */
import type { NicheKey } from "../niche";

const PARAMS = "?w=1600&auto=format&fit=crop&q=80";

function url(id: string): string {
  return `https://images.unsplash.com/photo-${id}${PARAMS}`;
}

// ---------------------------------------------------------------------------
// REUSED POOLS (verified in prior visual-QA passes)
// ---------------------------------------------------------------------------

// Home services — plumber working / pipe repair / on-job shots.
// Re-curated from the visual-QA pass that flagged the prior pool as looking
// like coding photos rather than plumber-specific.
const HOME_SERVICES = [
  url("1676210134190-3f2c0d5cf58d"),
  url("1662296416406-4ff3afef67fe"),
  url("1676210134188-4c05dd172f89"),
  url("1593583810872-ddee4d6bd55a"),
  url("1503387762-592deb58ef4e"),
  url("1638037619854-759f888f40de"),
  url("1664902131524-dd8bb87ad281"),
  url("1626436312908-bad0007396c0"),
];

const LANDSCAPING_CONSTRUCTION = [
  url("1649427909612-353b0042ab79"),
  url("1651888433177-271001c0fc09"),
  url("1657736508697-4f0bfa8f1b47"),
  url("1657736508663-22146f6c00aa"),
  url("1710376300099-79cd5e7e1ae1"),
  url("1597201278257-3687be27d954"),
  url("1690898796598-64e34f9e2a3c"),
  url("1665265368388-dbe023c7b0dd"),
];

// Beauty / wellness — bright modern salon / stylist / clean interior shots.
// Re-curated after visual-QA flagged a "too dark + odd Moet lifebuoy prop in hero."
const BEAUTY_WELLNESS = [
  url("1626383137804-ff908d2753a2"),
  url("1488282687151-c5e6582e7cf1"),
  url("1560066984-138dadb4c035"),
  url("1629397685944-7073f5589754"),
  url("1629397662600-50ad523ef4fb"),
  url("1675034743339-0b0747047727"),
  url("1647462741351-4e7a5e7317c7"),
  url("1556740758-90de374c12ad"),
];

const PROFESSIONAL_SERVICES = [
  url("1718220216044-006f43e3a9b1"),
  url("1765371513492-264506c3ad09"),
  url("1765371512336-99c2b1c6975f"),
  url("1774853094610-89be6f1a7690"),
  url("1765371515218-0a4c992ba8e2"),
  url("1774853102013-d51ac73f52a5"),
  url("1770816307817-2fa6131e3a9b"),
  url("1745970347652-8f22f5d7d3ba"),
];

const FOOD_BEVERAGE = [
  url("1767778080869-4b82b5924c3a"),
  url("1775281562991-7396061db512"),
  url("1650772263983-daebce6959c5"),
  url("1628627582892-a7736b5be159"),
  url("1750672831807-02188adaa7b0"),
  url("1750672832026-d38b2ad8e7d8"),
  url("1653491948158-9044bcbb9c5a"),
  url("1565720490558-136ad94e112f"),
];

const HOME_GOODS_VINTAGE = [
  url("1648939109875-d4f0c4f15b29"),
  url("1738541717422-2a332e7d7a65"),
  url("1652598631616-3f5f4d2cfbd5"),
  url("1647701586082-c0c5364a2acd"),
  url("1569424746512-4f98ac866469"),
  url("1753921156536-a9b79f9dfb4c"),
];

const REAL_ESTATE = [
  url("1638972691611-69633a3d3127"),
  url("1640109478916-f445f8f19b11"),
  url("1639173925921-5d5fd027713c"),
  url("1612301988752-5a5b19021f45"),
  url("1638541363822-6f4c189b5cf7"),
  url("1771862860802-bd2e375f7422"),
  url("1776482128172-dd265ad0cb49"),
  url("1715985160053-d339e8b6eb94"),
];

// ---------------------------------------------------------------------------
// NEW POOLS (sourced and verified for the 20-bucket expansion, Task 3)
// ---------------------------------------------------------------------------

// Cleaning / restoration — pressure washing + professional cleaning shots.
// Sourced from unsplash.com/s/photos/pressure-washing (all 6 verified 200).
const CLEANING_RESTORATION = [
  url("1581883579507-019c44b711cb"),
  url("1593260654732-df52bea15d63"),
  url("1718152521364-b9655b8a7926"),
  url("1718152470408-cfeebeb6b9fc"),
  url("1718152421680-d1580e843cc9"),
  url("1614359835514-92f8ba196357"),
];

// Roofing / exterior — workers on roofs, house exterior shots.
// Sourced from unsplash.com/s/photos/house-exterior-roof (all 6 verified 200).
const ROOFING_EXTERIOR = [
  url("1687800018282-9cc842a02877"),
  url("1711452463319-0a78a19dfc24"),
  url("1665848711778-a696998d1034"),
  url("1652582245640-34d8329bf424"),
  url("1605181964931-22d2a804489d"),
  url("1727303276973-140c09dc9542"),
];

// Construction / remodel — kitchen remodel + general contractor shots.
// Sourced from unsplash.com/s/photos/construction-remodel (all 6 verified 200).
const CONSTRUCTION_REMODEL = [
  url("1618832515490-e181c4794a45"),
  url("1505798577917-a65157d3320a"),
  url("1634586648651-f1fb9ec10d90"),
  url("1662394027253-dc37506c2587"),
  url("1543525324-26e03b510586"),
  url("1704742950992-9815a104820c"),
];

// Automotive — mechanic shop + car detailing.
// Sourced from unsplash.com/s/photos/auto-mechanic-shop + car-detailing
// (all 6 verified 200).
const AUTOMOTIVE = [
  url("1676018366904-c083ed678e60"),
  url("1702146715471-ae6b10689969"),
  url("1637640125496-31852f042a60"),
  url("1619642737579-a7474bee1044"),
  url("1567808291548-fc3ee04dbcf0"),
  url("1508974239320-0a029497e820"),
];

// Spa / massage / wellness — luxury spa interiors, treatment rooms.
// Sourced from unsplash.com/s/photos/luxury-spa-interior (all 6 verified 200).
const SPA_MASSAGE_WELLNESS = [
  url("1738407283641-5e127f36f47d"),
  url("1611920629515-3f76f8c36b37"),
  url("1731336479432-3eb5fdb3ab1c"),
  url("1776763019060-fa0663574ae6"),
  url("1776763255459-99ddd8eebbfc"),
  url("1776763018829-ad685e621871"),
];

// Fitness / gyms — gym equipment, personal trainer shots.
// Sourced from unsplash.com/s/photos/gym-workout-equipment (all 6 verified 200).
const FITNESS_GYMS = [
  url("1534438327276-14e5300c3a48"),
  url("1590487988256-9ed24133863e"),
  url("1637430308606-86576d8fef3c"),
  url("1540497077202-7c8a3999166f"),
  url("1576678927484-cc907957088c"),
  url("1641337221253-fdc7237f6b61"),
];

// Pet services — veterinary clinic + dog grooming shots.
// Sourced from unsplash.com/s/photos/veterinary-clinic + dog-groomer
// (all 6 verified 200).
const PET_SERVICES = [
  url("1654895716780-b4664497420d"),
  url("1551076805-e1869033e561"),
  url("1644675272883-0c4d582528d8"),
  url("1553688738-a278b9f063e0"),
  url("1611173622933-91942d394b04"),
  url("1719464454959-9cf304ef4774"),
];

// Food: cafe / bakery — coffee shop + bakery counter shots.
// Sourced from unsplash.com/s/photos/coffee-shop-cafe + bakery-pastry
// (all 6 verified 200).
const FOOD_CAFE_BAKERY = [
  url("1516197370049-569c4eaba1d6"),
  url("1594402919317-9e67dca0a305"),
  url("1574374752751-f511f816b69b"),
  url("1682979332603-f64421e2e0e9"),
  url("1642647916129-3909c75c0267"),
  url("1608198093002-ad4e005484ec"),
];

// Food: catering / events — event buffet + catering setup shots.
// Sourced from unsplash.com/s/photos/event-catering-buffet (all 6 verified 200).
const FOOD_CATERING_EVENTS = [
  url("1555244162-803834f70033"),
  url("1583338917496-7ea264c374ce"),
  url("1576842546422-60562b9242ae"),
  url("1740047602722-b4993b79e4b7"),
  url("1592868859049-dfdcd6c07c29"),
  url("1564638305579-5e395c9b62c7"),
];

// Professional: creative / tech — design studio + creative agency offices.
// Sourced from unsplash.com/s/photos/creative-agency-office (all 6 verified 200).
const PROFESSIONAL_CREATIVE_TECH = [
  url("1594732832278-abd644401426"),
  url("1568359415705-47e98104af04"),
  url("1504297050568-910d24c426d3"),
  url("1572025442646-866d16c84a54"),
  url("1658849110893-841726ccd937"),
  url("1559136555-9303baea8ebd"),
];

// Home decor retail — furniture showroom + interior design store shots.
// Sourced from unsplash.com/s/photos/interior-design-showroom (all 6 verified 200).
const HOME_DECOR_RETAIL = [
  url("1696774566203-b5883558badd"),
  url("1587717292307-6f3e2cd2f581"),
  url("1681739867179-1e6009bf9071"),
  url("1760072513403-d70003481414"),
  url("1524061614234-8449637d36ce"),
  url("1764512680324-048f158cab2b"),
];

// Event services — balloon garlands, wedding florals, event decor.
// Sourced from unsplash.com/s/photos/balloon-garland-event (all 6 verified 200).
const EVENT_SERVICES = [
  url("1611142288262-3bb8f5fc45d7"),
  url("1560128411-79892dd93bf8"),
  url("1597509679245-6fe7e1d7781c"),
  url("1676311140009-dc458dfe3fbe"),
  url("1587160728015-924483626a1a"),
  url("1758870041148-31d28fdf34d9"),
];

// Boutique / gift / retail — clothing store + boutique interior shots.
// Sourced from unsplash.com/s/photos/clothing-store-retail (all 6 verified 200).
const BOUTIQUE_GIFT_RETAIL = [
  url("1441984904996-e0b6ba687e04"),
  url("1441986300917-64674bd600d8"),
  url("1532453288672-3a27e9be9efd"),
  url("1567401893414-76b7b1e5a7a5"),
  url("1540221652346-e5dd6b50f3e7"),
  url("1546213290-e1b492ab3eee"),
];

// Entertainment-venues — bowling, arcades, escape rooms, comedy clubs,
// theaters, music venues, karaoke, banquet halls. Visual: neon lights,
// stage scenes, arcade glow, theater interiors, party crowds. The vibe
// is energetic and atmospheric.
//
// All IDs HEAD-tested 200 against images.unsplash.com. Earlier draft
// included two invented IDs (1571266028243-d220bc8df6f1 and
// 1571266028243-e1c66e34a5e6) that returned 404 — visible on the DJ
// showcase as black-background service cards. Removed.
const ENTERTAINMENT_VENUES: string[] = [
  url("1493676304819-0d7a8d026dcf"), // stage lights / theater
  url("1514525253161-7a46d19cd819"), // bowling lane
  url("1574391884720-bbc3740c59d1"), // comedy/stage spotlight
  url("1518609878373-06d740f60d8b"), // concert / live music crowd
  url("1485231183945-fffde7cc051e"), // theater seats / cinema
  url("1546412414-e1885259563a"),    // pool/billiards table
];

// Entertainment-services — DJs, bands, musicians, magicians, MCs, kids
// entertainers. Visual: stage equipment, DJ booth, mic, band performing,
// crowd reaction. People-first / talent-driven.
//
// All IDs HEAD-tested 200. The same fake 1571266028243-d220bc8df6f1
// was in this pool too — removed.
const ENTERTAINMENT_SERVICES: string[] = [
  url("1493225457124-a3eb161ffa5f"), // microphone close-up stage
  url("1501386761578-eac5c94b800a"), // DJ at decks
  url("1470229722913-7c0e2dbbafd3"), // band live performance
  url("1516280440614-37939bbacd81"), // music studio / equipment
  url("1525362081669-2b476bb628c3"), // singer on stage with mic
  url("1453738773917-9c3eff1db985"), // crowd hands up at concert
  url("1429962714451-bb934ecdc4ec"), // turntables / DJ gear
];

// ---------------------------------------------------------------------------
// POOL MAP — one entry per NicheKey (22 total)
// ---------------------------------------------------------------------------

export const POOL_BY_NICHE: Record<NicheKey, string[]> = {
  "home-services-trades":       HOME_SERVICES,
  "cleaning-restoration":       CLEANING_RESTORATION,
  "roofing-exterior":           ROOFING_EXTERIOR,
  "landscaping-outdoor":        LANDSCAPING_CONSTRUCTION,
  "construction-remodel":       CONSTRUCTION_REMODEL,
  "automotive":                 AUTOMOTIVE,
  "beauty-hair-nails":          BEAUTY_WELLNESS,
  "spa-massage-wellness":       SPA_MASSAGE_WELLNESS,
  "fitness-gyms":               FITNESS_GYMS,
  "pet-services":               PET_SERVICES,
  "food-restaurants":           FOOD_BEVERAGE,
  "food-cafe-bakery":           FOOD_CAFE_BAKERY,
  "food-catering-events":       FOOD_CATERING_EVENTS,
  "professional-legal-financial": PROFESSIONAL_SERVICES,
  "professional-creative-tech": PROFESSIONAL_CREATIVE_TECH,
  "real-estate":                REAL_ESTATE,
  "vintage-antiques-thrift":    HOME_GOODS_VINTAGE,
  "home-decor-retail":          HOME_DECOR_RETAIL,
  "event-services":             EVENT_SERVICES,
  "boutique-gift-retail":       BOUTIQUE_GIFT_RETAIL,
  "entertainment-venues":       ENTERTAINMENT_VENUES,
  "entertainment-services":     ENTERTAINMENT_SERVICES,
};

/**
 * Pick `count` stock photos for a niche. Pulls from the head of the pool —
 * deterministic so two leads in the same niche share the same hero shot,
 * but their REAL photos differ enough to keep sites distinct. If the pool
 * is shorter than `count`, falls through to home-services-trades.
 */
export function pickStockPhotosForNiche(niche: NicheKey, count: number): string[] {
  const pool = POOL_BY_NICHE[niche] ?? POOL_BY_NICHE["home-services-trades"];
  // Return whatever's available — DO NOT cross-pollinate from
  // home-services-trades. The bug that caused this comment: a balloon
  // event-styling lead (event-services niche, 6 stock photos) shipped
  // with 2 plumbing photos on the page because pickStockPhotos asked
  // for 8 and the function used to pad with home-services. Niche fit
  // is non-negotiable. The photo selector downstream knows how to
  // work with fewer than `count` candidates — the template renders
  // up to 6 slots and never crashes on undersupply.
  return pool.slice(0, count);
}

/**
 * Detect a cached photo list that was assembled for a DIFFERENT niche
 * than the lead's current classification. Returns true when every URL
 * in the list either comes from the current niche's pool OR isn't from
 * any stock pool at all (i.e. it's a real Google Places photo). Returns
 * false when at least one URL belongs to a foreign niche's pool — the
 * cache predates a re-classification and needs to be rebuilt.
 *
 * Used by stage-3 to auto-invalidate stale photo caches without forcing
 * the operator to remember `?refresh-photos=1`.
 */
export function cachedPhotosMatchNiche(cached: string[], niche: NicheKey): boolean {
  const ownPool = new Set(POOL_BY_NICHE[niche] ?? []);
  // Build the set of URLs that belong to ANY OTHER niche's stock pool.
  const foreignStock = new Set<string>();
  for (const [key, pool] of Object.entries(POOL_BY_NICHE)) {
    if (key === niche) continue;
    for (const url of pool) {
      if (!ownPool.has(url)) foreignStock.add(url);
    }
  }
  for (const url of cached) {
    if (foreignStock.has(url)) return false;
  }
  return true;
}

/**
 * Legacy entry point kept for callers that only know the template_slug.
 * Maps premium-trades / trades to home-services-trades. Prefer pickStockPhotosForNiche
 * when the niche is known (lib/pipeline/stage-3-generate.ts already knows it).
 */
export function pickStockPhotos(_templateSlug: string, count: number): string[] {
  return pickStockPhotosForNiche("home-services-trades", count);
}

export const STOCK_PHOTOS_BY_TEMPLATE: Record<string, string[]> = {
  trades: HOME_SERVICES,
  "premium-trades": HOME_SERVICES,
};
