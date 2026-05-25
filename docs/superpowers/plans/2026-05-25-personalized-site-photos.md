# Personalized Site Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each generated demo site visually distinct by picking a per-lead hero photo (real Google photo preferred, Gemini Vision chooses) and splitting the coarse 8 niche buckets into 20 so businesses like balloon-styling stop sharing a stock pool with antique sellers.

**Architecture:** Three surfaces. (1) `web/lib/niche.ts` grows from 8 → 20 buckets with new regex matchers. (2) `web/lib/services/photo-selector.ts` (new) makes one Gemini Vision call per lead lifetime to pick the hero + order all 6 photo slots, caching the result on `leads.hero_photo_url` / `leads.photo_order_json`. (3) `web/lib/picker.ts` gates hero variant choice on actual photo count so layouts match what we have.

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase (Postgres), `@google/genai` (Gemini 2.5 Flash), Astro templates downstream. No test framework installed — verification is via `tsx` runner scripts that match the existing `web/scripts/...` convention.

**Spec:** [docs/superpowers/specs/2026-05-25-personalized-site-photos-design.md](../specs/2026-05-25-personalized-site-photos-design.md)

---

## Task 1: DB migration for photo cache columns

**Files:**
- Create: `db/migrations/013_lead_photo_cache.sql`

- [ ] **Step 1: Create the migration file**

Write to `db/migrations/013_lead_photo_cache.sql`:

```sql
-- 013_lead_photo_cache.sql
--
-- Caches per-lead photo selection so the Gemini Vision call in stage-3
-- fires once per lead lifetime (not once per rebuild). Three columns:
--
--   hero_photo_url    text     — chosen hero URL (stock or real)
--   photo_order_json  jsonb    — full ordered photo array (length 6)
--   photos_picked_at  timestamptz — last time we ran the selector
--
-- A cache hit requires BOTH hero_photo_url AND photo_order_json to be
-- non-NULL; partial state from a half-failed prior write triggers a
-- re-pick. Cleared by /api/leads/:id/build?refresh-photos=1 when the
-- operator wants a fresh selection (e.g. after Improve added new photos).
--
-- See docs/superpowers/specs/2026-05-25-personalized-site-photos-design.md

alter table leads
    add column if not exists hero_photo_url    text,
    add column if not exists photo_order_json  jsonb,
    add column if not exists photos_picked_at  timestamptz;
```

- [ ] **Step 2: Apply the migration to Supabase**

Run from the repo root:

```bash
psql "$SUPABASE_URL" -f db/migrations/013_lead_photo_cache.sql
```

Expected: `ALTER TABLE` (three times if executed atomically, once with the multi-column form). If you don't have psql locally, paste the SQL into the Supabase SQL editor at https://supabase.com/dashboard/project/<project-id>/sql/new and click Run.

- [ ] **Step 3: Verify columns exist**

```bash
psql "$SUPABASE_URL" -c "\\d leads" | grep -E "hero_photo_url|photo_order_json|photos_picked_at"
```

Expected output (3 lines, types may render slightly differently):

```
 hero_photo_url    | text                     |
 photo_order_json  | jsonb                    |
 photos_picked_at  | timestamp with time zone |
```

- [ ] **Step 4: Commit**

```bash
git add db/migrations/013_lead_photo_cache.sql
git commit -m "db: add hero_photo_url + photo_order_json + photos_picked_at to leads"
```

---

## Task 2: Expand niche taxonomy from 8 → 20 buckets

**Files:**
- Modify: `web/lib/niche.ts` (rewrite the `NicheKey` union + `MATCHERS` array)
- Create: `web/scripts/check-niche.ts` (verification script, matches existing `web/scripts/*.ts` pattern)

- [ ] **Step 1: Write the verification script first (this is the failing test)**

Create `web/scripts/check-niche.ts`:

```ts
/**
 * check-niche.ts — Assertion-based verification for classifyNiche.
 *
 * Run with: npx tsx scripts/check-niche.ts (from web/)
 * Exits non-zero on any failure so it can be wired into CI later.
 */
import { classifyNiche, type NicheKey } from "../lib/niche";

interface Case {
  category: string | null;
  business_name: string;
  expected: NicheKey;
  note?: string;
}

const CASES: Case[] = [
  // Real-world failing cases from the 2026-05-25 audit
  { category: "consultant", business_name: "Mimi and Me Estate Sales", expected: "vintage-antiques-thrift", note: "estate sale company" },
  { category: "home_goods_store", business_name: "The Little Things | Balloon Garlands & Event Styling Hamilton", expected: "event-services", note: "balloon styling miscategorized by Google" },

  // Each of the 20 buckets — one canonical example
  { category: "Plumber", business_name: "Joe's Plumbing", expected: "home-services-trades" },
  { category: null, business_name: "Aqua Restoration Services", expected: "cleaning-restoration" },
  { category: "Roofing contractor", business_name: "Aspen Roofing", expected: "roofing-exterior" },
  { category: "Landscaper", business_name: "Green Thumb Landscaping", expected: "landscaping-outdoor" },
  { category: "General contractor", business_name: "Texas Remodel Co", expected: "construction-remodel" },
  { category: "Auto repair shop", business_name: "Big Tex Mechanic", expected: "automotive" },
  { category: "Hair salon", business_name: "Bluebonnet Salon", expected: "beauty-hair-nails" },
  { category: "Massage therapist", business_name: "Calm Wellness Spa", expected: "spa-massage-wellness" },
  { category: "Gym", business_name: "Iron Pulse Fitness", expected: "fitness-gyms" },
  { category: "Veterinarian", business_name: "Riverside Pet Hospital", expected: "pet-services" },
  { category: "Restaurant", business_name: "Lone Star Diner", expected: "food-restaurants" },
  { category: "Cafe", business_name: "Sunrise Coffee Bakery", expected: "food-cafe-bakery" },
  { category: "Caterer", business_name: "Texas Catering Co", expected: "food-catering-events" },
  { category: "Lawyer", business_name: "Smith Law Firm", expected: "professional-legal-financial" },
  { category: "Marketing agency", business_name: "Pearl Creative Studio", expected: "professional-creative-tech" },
  { category: "Real estate agency", business_name: "Hill Country Realtors", expected: "real-estate" },
  { category: "Antique store", business_name: "Granny's Antiques", expected: "vintage-antiques-thrift" },
  { category: "Furniture store", business_name: "Modern Living Furniture", expected: "home-decor-retail" },
  { category: "Florist", business_name: "Petal & Stem Floral", expected: "event-services" },
  { category: "Jewelry store", business_name: "Diamond Boutique", expected: "boutique-gift-retail" },

  // Edge cases
  { category: null, business_name: "", expected: "home-services-trades", note: "empty → default" },
  { category: "home_goods_store", business_name: "Aunt Mae's Antique Mart", expected: "vintage-antiques-thrift", note: "name beats category" },
];

let failed = 0;
for (const c of CASES) {
  const got = classifyNiche(c.category, c.business_name);
  if (got !== c.expected) {
    failed++;
    console.error(
      `FAIL  category=${JSON.stringify(c.category)} name=${JSON.stringify(c.business_name)}` +
        `\n      expected=${c.expected}  got=${got}` +
        (c.note ? `\n      note=${c.note}` : ""),
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${CASES.length} cases failed.`);
  process.exit(1);
}
console.log(`OK — ${CASES.length}/${CASES.length} niche cases pass.`);
```

- [ ] **Step 2: Run the verification script — verify it FAILS**

From `web/`:

```bash
npx tsx scripts/check-niche.ts
```

Expected: at minimum 18 failures — the new NicheKey values don't exist yet, so classifyNiche returns the old buckets. The script exits with code 1.

- [ ] **Step 3: Rewrite `web/lib/niche.ts` with the 20-bucket taxonomy**

Replace the entire contents of `web/lib/niche.ts` with:

```ts
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
  | "boutique-gift-retail";

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
  // Spa / massage / wellness
  {
    niche: "spa-massage-wellness",
    pattern: /\b(spa|massage|sauna|wellness|holistic|reflex|chiropract|acupuncture)\b/i,
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
    pattern: /\b(roof|gutter|siding|stucco|exterior ?paint|window ?install)\b/i,
  },
  // Landscaping / outdoor work (must come before construction-remodel)
  {
    niche: "landscaping-outdoor",
    pattern: /\b(landscap|lawn|garden|tree|arborist|paving|concrete|deck|fenc|hardscape|sprinkler|irrigation|pool ?clean|pool ?service)\b/i,
  },
  // Construction / general remodel / carpentry
  {
    niche: "construction-remodel",
    pattern: /\b(construct|remodel|carpent|excavat|general ?contractor|home ?builder|kitchen ?remodel|bath ?remodel)\b/i,
  },
  // Cleaning / restoration / movers / junk removal
  {
    niche: "cleaning-restoration",
    pattern: /\b(carpet ?clean|water ?damage|disaster|restoration|junk ?removal|movers?|moving ?company|cleaning ?service|maid ?service|pressure ?wash|window ?cleaning)\b/i,
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
```

- [ ] **Step 4: Run the verification script — verify it PASSES**

From `web/`:

```bash
npx tsx scripts/check-niche.ts
```

Expected: `OK — 24/24 niche cases pass.` (exit 0).

If any fail, the FAIL line shows category + name + expected + got. Adjust either the matcher regex order OR the regex itself, then re-run.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no output (or just the `> leadgen-web@0.1.0 typecheck` banner). Several downstream files reference `NicheKey` values that no longer exist — `picker.ts` `pickTheme()` switch, `picker.ts` `PHOTOGENIC`/`HIGH_INTENT` arrays, `stock-photos.ts` `POOL_BY_NICHE` map. They use string literals against `NicheKey`, so TypeScript WILL flag mismatches.

If errors land in `picker.ts` or `stock-photos.ts`: do NOT fix those errors yet. The next tasks are about rewriting those files. Comment out the offending lines temporarily, OR (cleaner) cast the obsolete cases as `as NicheKey` so it compiles. Note the file locations — we'll fix them in Tasks 3 and 6.

- [ ] **Step 6: Commit**

```bash
git add web/lib/niche.ts web/scripts/check-niche.ts
git commit -m "feat(niche): split into 20 buckets — event-services, automotive, etc."
```

---

## Task 3: Stock photo pools for the new niches

**Files:**
- Modify: `web/lib/data/stock-photos.ts` (replace `POOL_BY_NICHE` map; keep verified existing pools, add new ones)

- [ ] **Step 1: Source verified Unsplash photo IDs for each new niche**

For each new niche listed below, open https://unsplash.com/s/photos/<keyword> in a browser. Pick 6 photos that:
- Are landscape orientation
- Show the actual business activity (not abstract / branding)
- Are well-lit and high contrast
- Don't contain prominent text overlays or watermarks
- Click each photo and grab the ID from the URL — format `https://unsplash.com/photos/<slug>-<id>` → the trailing 11-digit number (or alphanumeric for newer IDs)

**Hard rule from `stock-photos.ts` existing comment:** every ID must be personally verified by visiting `https://images.unsplash.com/photo-<id>?w=1600&auto=format&fit=crop&q=80` and confirming it returns a 200, not a 404. Photos 404 silently as broken `<img>` on shipped sites.

Keywords to search per new niche:
- `home-services-trades` → "plumber", "HVAC technician", "electrician working" (existing `HOME_SERVICES` pool can be reused)
- `cleaning-restoration` → "professional cleaning service", "carpet cleaning"
- `roofing-exterior` → "roofers working", "house exterior siding"
- `landscaping-outdoor` → "landscaping crew", "manicured lawn" (existing `LANDSCAPING_CONSTRUCTION` works)
- `construction-remodel` → "kitchen remodel", "general contractor"
- `automotive` → "auto mechanic shop", "car detailing"
- `beauty-hair-nails` → "modern hair salon" (existing `BEAUTY_WELLNESS` works)
- `spa-massage-wellness` → "luxury spa interior", "massage table"
- `fitness-gyms` → "modern gym interior", "personal trainer"
- `pet-services` → "dog grooming", "vet clinic"
- `food-restaurants` → "restaurant interior dinner" (existing `FOOD_BEVERAGE` works)
- `food-cafe-bakery` → "coffee shop interior", "bakery counter"
- `food-catering-events` → "event catering buffet"
- `professional-legal-financial` → "law office interior", "modern accounting office" (existing `PROFESSIONAL_SERVICES` works)
- `professional-creative-tech` → "design studio interior", "creative agency"
- `real-estate` → "luxury home exterior", "modern home interior"
- `vintage-antiques-thrift` → "antique shop interior", "vintage furniture" (existing `HOME_GOODS_VINTAGE` works here, NOT for event-services)
- `home-decor-retail` → "modern furniture showroom", "home decor store"
- `event-services` → "balloon garland", "wedding floral arrangement", "event styling"
- `boutique-gift-retail` → "boutique store interior", "jewelry store display"

If you cannot source 6 verified photos for a given new niche, use 4 minimum. Smaller pools work — the hash-fallback rule in photo-selector handles any pool size > 0.

- [ ] **Step 2: Rewrite the export map in `web/lib/data/stock-photos.ts`**

Read the current file first to preserve the file header comments and the `url()` helper. Then replace ALL named pool constants + the export with the new 20-bucket map. The structure stays identical to today's — just more entries and renamed pools.

Approximate target file structure (fill in the actual IDs from Step 1):

```ts
// Top of file: keep existing header comments + url() helper unchanged.

const HOME_SERVICES_TRADES = [ url("..."), url("..."), /* 6-8 entries */ ];
const CLEANING_RESTORATION = [ url("..."), /* 6+ entries */ ];
const ROOFING_EXTERIOR = [ /* ... */ ];
const LANDSCAPING_OUTDOOR = [ /* ... */ ];
const CONSTRUCTION_REMODEL = [ /* ... */ ];
const AUTOMOTIVE = [ /* ... */ ];
const BEAUTY_HAIR_NAILS = [ /* ... */ ];
const SPA_MASSAGE_WELLNESS = [ /* ... */ ];
const FITNESS_GYMS = [ /* ... */ ];
const PET_SERVICES = [ /* ... */ ];
const FOOD_RESTAURANTS = [ /* ... */ ];
const FOOD_CAFE_BAKERY = [ /* ... */ ];
const FOOD_CATERING_EVENTS = [ /* ... */ ];
const PROFESSIONAL_LEGAL_FINANCIAL = [ /* ... */ ];
const PROFESSIONAL_CREATIVE_TECH = [ /* ... */ ];
const REAL_ESTATE = [ /* ... */ ];
const VINTAGE_ANTIQUES_THRIFT = [ /* ... */ ];
const HOME_DECOR_RETAIL = [ /* ... */ ];
const EVENT_SERVICES = [ /* ... */ ];
const BOUTIQUE_GIFT_RETAIL = [ /* ... */ ];

const POOL_BY_NICHE: Record<NicheKey, string[]> = {
  "home-services-trades": HOME_SERVICES_TRADES,
  "cleaning-restoration": CLEANING_RESTORATION,
  "roofing-exterior": ROOFING_EXTERIOR,
  "landscaping-outdoor": LANDSCAPING_OUTDOOR,
  "construction-remodel": CONSTRUCTION_REMODEL,
  "automotive": AUTOMOTIVE,
  "beauty-hair-nails": BEAUTY_HAIR_NAILS,
  "spa-massage-wellness": SPA_MASSAGE_WELLNESS,
  "fitness-gyms": FITNESS_GYMS,
  "pet-services": PET_SERVICES,
  "food-restaurants": FOOD_RESTAURANTS,
  "food-cafe-bakery": FOOD_CAFE_BAKERY,
  "food-catering-events": FOOD_CATERING_EVENTS,
  "professional-legal-financial": PROFESSIONAL_LEGAL_FINANCIAL,
  "professional-creative-tech": PROFESSIONAL_CREATIVE_TECH,
  "real-estate": REAL_ESTATE,
  "vintage-antiques-thrift": VINTAGE_ANTIQUES_THRIFT,
  "home-decor-retail": HOME_DECOR_RETAIL,
  "event-services": EVENT_SERVICES,
  "boutique-gift-retail": BOUTIQUE_GIFT_RETAIL,
};

export function pickStockPhotosForNiche(niche: NicheKey, n: number): string[] {
  const pool = POOL_BY_NICHE[niche] ?? POOL_BY_NICHE["home-services-trades"];
  return pool.slice(0, Math.min(n, pool.length));
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd web && npm run typecheck
```

Expected: clean. If errors mention `POOL_BY_NICHE` not having a `NicheKey` member, the map is missing an entry — TypeScript's `Record<NicheKey, ...>` will flag it.

- [ ] **Step 4: Verify the pools resolve at the network layer (spot check)**

Pick 5 random URLs across the new pools, paste each into `curl -sIL <url> | head -1`. Each must return `HTTP/2 200` (or `HTTP/1.1 200`). Any 404 means a typo'd ID — fix before continuing.

```bash
curl -sIL "https://images.unsplash.com/photo-<id>?w=1600&auto=format&fit=crop&q=80" | head -1
```

- [ ] **Step 5: Commit**

```bash
git add web/lib/data/stock-photos.ts
git commit -m "feat(stock-photos): pools for 20 niches (event-services, automotive, etc.)"
```

---

## Task 4: photo-selector.ts skeleton + hash-fallback branch

**Files:**
- Create: `web/lib/services/photo-selector.ts`
- Create: `web/scripts/check-photo-selector.ts`

This task builds the no-real-photos branch only. The Vision branch is Task 5.

- [ ] **Step 1: Write the verification script first**

Create `web/scripts/check-photo-selector.ts`:

```ts
/**
 * check-photo-selector.ts — Assertion-based verification for photo-selector.
 *
 * Run with: npx tsx scripts/check-photo-selector.ts (from web/)
 */
import { selectPhotos } from "../lib/services/photo-selector";

const STOCK_POOL = [
  "https://images.unsplash.com/photo-a?w=1600",
  "https://images.unsplash.com/photo-b?w=1600",
  "https://images.unsplash.com/photo-c?w=1600",
  "https://images.unsplash.com/photo-d?w=1600",
  "https://images.unsplash.com/photo-e?w=1600",
  "https://images.unsplash.com/photo-f?w=1600",
];

let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL  ${label}` + (detail ? `\n      ${detail}` : ""));
  }
}

(async () => {
  // (a) No real photos → hash fallback, source=no-real-photos, no Gemini call.
  const r1 = await selectPhotos({
    lead: { id: "00000000-aaaa-bbbb-cccc-000000000001", business_name: "Test Co", category: null },
    niche: "home-services-trades",
    realPhotos: [],
    stockPool: STOCK_POOL,
  });
  check("(a) no-real-photos source", r1.source === "no-real-photos");
  check("(a) ordered_photos length === 6", r1.ordered_photos.length === 6);
  check("(a) hero is from stock pool", STOCK_POOL.includes(r1.hero));
  check("(a) hero === ordered_photos[0]", r1.hero === r1.ordered_photos[0]);

  // (b) Determinism — same lead id → same fallback hero.
  const r2 = await selectPhotos({
    lead: { id: "00000000-aaaa-bbbb-cccc-000000000001", business_name: "Test Co", category: null },
    niche: "home-services-trades",
    realPhotos: [],
    stockPool: STOCK_POOL,
  });
  check("(b) deterministic hero", r1.hero === r2.hero);

  // (c) Different lead ids → likely different heroes (pool has 6, so 6 buckets).
  const r3 = await selectPhotos({
    lead: { id: "11111111-cccc-dddd-eeee-111111111111", business_name: "Other Co", category: null },
    niche: "home-services-trades",
    realPhotos: [],
    stockPool: STOCK_POOL,
  });
  check(
    "(c) different id usually picks different hero (probabilistic)",
    // Both could land on same hero by chance (1/6 = 17%), but with 6-photo pool,
    // a UUID-keyed hash should disperse. We require AT LEAST ONE difference
    // across the 4 sample IDs below.
    true,  // checked below
  );

  // (d) Cross-sample dispersion — across 10 random UUIDs, we see at least 3
  // distinct heroes in a 6-photo pool.
  const samples = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      selectPhotos({
        lead: { id: `00000000-aaaa-bbbb-cccc-0000000000${String(i + 10).padStart(2, "0")}`, business_name: `Co${i}`, category: null },
        niche: "home-services-trades",
        realPhotos: [],
        stockPool: STOCK_POOL,
      }),
    ),
  );
  const unique = new Set(samples.map((s) => s.hero));
  check(
    "(d) dispersion: 10 ids → ≥3 distinct heroes",
    unique.size >= 3,
    `got ${unique.size} unique`,
  );

  if (failed > 0) {
    console.error(`\n${failed} assertions failed.`);
    process.exit(1);
  }
  console.log(`OK — photo-selector hash-fallback verified.`);
})();
```

- [ ] **Step 2: Run the verification script — verify it FAILS**

From `web/`:

```bash
npx tsx scripts/check-photo-selector.ts
```

Expected: `Cannot find module '../lib/services/photo-selector'` — the file doesn't exist yet.

- [ ] **Step 3: Create `web/lib/services/photo-selector.ts` with the no-real-photos branch**

```ts
/**
 * photo-selector.ts — Pick the hero photo and order all 6 photo slots for a
 * lead's demo site. Real Google photos are preferred; falls back to niche
 * stock when none exist or when Gemini Vision returns low confidence.
 *
 * Inputs:  lead identity, niche, resolved real-photo URLs, top-N stock candidates
 * Outputs: { hero, ordered_photos (length === TOTAL_PHOTOS), vision_score, source }
 * Used by: lib/pipeline/stage-3-generate.ts (caches the result on the lead row
 *          so the Vision call fires once per lead lifetime, not per build).
 *
 * See docs/superpowers/specs/2026-05-25-personalized-site-photos-design.md
 */
import { createHash } from "node:crypto";
import type { NicheKey } from "../niche";

const TOTAL_PHOTOS = 6;

export interface PhotoSelectorInput {
  lead: { id: string; business_name: string; category: string | null };
  niche: NicheKey;
  realPhotos: string[];
  stockPool: string[];
}

export interface PhotoSelectorOutput {
  hero: string;
  ordered_photos: string[];
  vision_score: number;
  source: "vision" | "hash-fallback" | "no-real-photos";
}

/**
 * Deterministic int in [0, n) from a string. Same input → same output across
 * processes and machines. SHA-256 → first 8 hex chars → modulo n.
 */
function hashIndex(seed: string, n: number): number {
  if (n <= 0) return 0;
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return parseInt(digest, 16) % n;
}

/**
 * Build a deterministic photo ordering when no real photos exist:
 *   • hero = hashed pick from stockPool
 *   • remaining slots = stockPool rotated so the hero is first, padded to
 *     TOTAL_PHOTOS with cycling if the pool is smaller than 6.
 */
function noRealPhotosOrder(leadId: string, stockPool: string[]): string[] {
  if (stockPool.length === 0) return [];
  const start = hashIndex(leadId, stockPool.length);
  const rotated = [...stockPool.slice(start), ...stockPool.slice(0, start)];
  const out: string[] = [];
  for (let i = 0; i < TOTAL_PHOTOS; i++) {
    out.push(rotated[i % rotated.length]);
  }
  return out;
}

export async function selectPhotos(
  input: PhotoSelectorInput,
): Promise<PhotoSelectorOutput> {
  // Branch 1: no real photos — hash fallback, no Gemini call.
  if (input.realPhotos.length === 0) {
    const ordered = noRealPhotosOrder(input.lead.id, input.stockPool);
    return {
      hero: ordered[0] ?? "",
      ordered_photos: ordered,
      vision_score: 0,
      source: "no-real-photos",
    };
  }

  // Branch 2: has real photos — Vision branch (Task 5 wires this in).
  // For now: temporarily fall back to hash. Replaced in Task 5.
  const ordered = noRealPhotosOrder(input.lead.id, input.stockPool);
  return {
    hero: ordered[0] ?? "",
    ordered_photos: ordered,
    vision_score: 0,
    source: "hash-fallback",
  };
}
```

- [ ] **Step 4: Run the verification script — verify it PASSES**

```bash
npx tsx scripts/check-photo-selector.ts
```

Expected: `OK — photo-selector hash-fallback verified.` (exit 0).

If `(d) dispersion` fails: the hash is collapsing to fewer than 3 buckets. Check that `hashIndex` is using a wide enough digest slice and that `stockPool.length` is 6 in the test.

- [ ] **Step 5: Run typecheck**

```bash
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/lib/services/photo-selector.ts web/scripts/check-photo-selector.ts
git commit -m "feat(photo-selector): hash-fallback branch + verification script"
```

---

## Task 5: photo-selector.ts — Gemini Vision branch

**Files:**
- Modify: `web/lib/services/gemini.ts` (add `selectHeroPhoto` export)
- Modify: `web/lib/services/photo-selector.ts` (call Gemini, parse, fall through on error)
- Modify: `web/scripts/check-photo-selector.ts` (add Vision-branch cases that mock the client)

- [ ] **Step 1: Add `selectHeroPhoto` to `web/lib/services/gemini.ts`**

Append to the file after the existing `generateSiteData` export (use the same pattern as `generateCopyFromStrategy` — `client().models.generateContent`, `responseMimeType: "application/json"`, `responseSchema`, `retry` wrapper):

```ts
/**
 * VISION schema for selectHeroPhoto: Gemini returns the chosen hero URL,
 * the full ordered list (length === input candidate count), and a score
 * 0-100 indicating its confidence that `hero_url` flatters the business.
 *
 * Used by lib/services/photo-selector.ts. Free-tier-friendly: one call per
 * lead lifetime (cached on leads.hero_photo_url + photo_order_json).
 */
const SELECT_HERO_SCHEMA = {
  type: Type.OBJECT,
  required: ["hero_url", "ordered_urls", "score"],
  properties: {
    hero_url: { type: Type.STRING },
    ordered_urls: { type: Type.ARRAY, items: { type: Type.STRING } },
    score: { type: Type.NUMBER },
  },
} as const;

const SELECT_HERO_PROMPT = `You are choosing the hero photo for a small-business website demo.

You will see:
  • The business name + niche bucket.
  • A list of candidate image URLs. Some are real Google Maps photos of THIS business; some are premium stock photos from the niche pool.

Pick the candidate that would make the strongest hero image for THIS business specifically — judging composition, lighting, content fit to the niche, and absence of distracting artifacts (phone-snapshot tilt, glare, watermarks, blurry signage).

Return:
  • hero_url: exactly one candidate URL.
  • ordered_urls: ALL provided URLs, reordered from best to worst hero-fit.
    The first entry MUST equal hero_url.
  • score: 0-100. Below 40 means "none of these are a good hero" — caller falls back to a deterministic pick.

Bias toward real business photos when their quality is acceptable. The user values authenticity over polish, but a tilted dark phone snapshot beats nothing only narrowly — give it a low score and the caller decides.`;

export interface SelectHeroInput {
  business_name: string;
  niche: string;
  candidates: string[];  // mix of real Google photos + niche stock pool
}

export interface SelectHeroOutput {
  hero_url: string;
  ordered_urls: string[];
  score: number;
}

export async function selectHeroPhoto(input: SelectHeroInput): Promise<SelectHeroOutput> {
  log.info({ business: input.business_name, candidates: input.candidates.length }, "gemini.select_hero.request");

  const parts: Array<{ text?: string; fileData?: { mimeType: string; fileUri: string } }> = [
    {
      text: `Business: ${input.business_name}\nNiche: ${input.niche}\nCandidates (in order — refer to them by URL):\n${input.candidates.join("\n")}`,
    },
  ];
  for (const url of input.candidates) {
    parts.push({ fileData: { mimeType: "image/jpeg", fileUri: url } });
  }

  const resp = await retry(
    () =>
      client().models.generateContent({
        model: env.GOOGLE_GENAI_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: SELECT_HERO_PROMPT,
          responseMimeType: "application/json",
          responseSchema: SELECT_HERO_SCHEMA,
          temperature: 0.3,        // tight — we want a defensible pick
          maxOutputTokens: 1024,    // schema is tiny
        },
      }),
    { maxAttempts: 2 },
  );

  const text = resp.text ?? "";
  try {
    return JSON.parse(text) as SelectHeroOutput;
  } catch {
    log.error({ text: text.slice(0, 300) }, "gemini.select_hero.bad_json");
    throw new Error("gemini select_hero returned non-JSON");
  }
}
```

- [ ] **Step 2: Replace the placeholder Vision branch in `web/lib/services/photo-selector.ts`**

First, at the TOP of the file (with the other imports/constants), add:

```ts
import { selectHeroPhoto } from "./gemini";
import { getLogger } from "../logger";

const log = getLogger("photo-selector");
const MIN_VISION_SCORE = 40;
const MAX_STOCK_CANDIDATES = 3;
const MAX_REAL_CANDIDATES = 4;
```

Then inside `selectPhotos`, replace the existing `// Branch 2: has real photos` block (the temporary fallback created in Task 4) with the real implementation:

```ts
  // Branch 2: has real photos — one Gemini Vision call.
  const stockCandidates = input.stockPool.slice(0, MAX_STOCK_CANDIDATES);
  const realCandidates = input.realPhotos.slice(0, MAX_REAL_CANDIDATES);
  const candidates = [...realCandidates, ...stockCandidates];

  let vision: { hero_url: string; ordered_urls: string[]; score: number } | null = null;
  try {
    vision = await selectHeroPhoto({
      business_name: input.lead.business_name,
      niche: input.niche,
      candidates,
    });
  } catch (err) {
    log.warn({ lead_id: input.lead.id, err: String(err).slice(0, 200) }, "vision.failed");
  }

  if (vision && vision.score >= MIN_VISION_SCORE && candidates.includes(vision.hero_url)) {
    // Pad ordered_urls to TOTAL_PHOTOS using leftover candidates + stock pool.
    const used = new Set<string>(vision.ordered_urls);
    const padding: string[] = [];
    for (const u of [...candidates, ...input.stockPool]) {
      if (used.has(u)) continue;
      used.add(u);
      padding.push(u);
      if (vision.ordered_urls.length + padding.length >= TOTAL_PHOTOS) break;
    }
    const ordered = [...vision.ordered_urls, ...padding].slice(0, TOTAL_PHOTOS);
    return {
      hero: vision.hero_url,
      ordered_photos: ordered,
      vision_score: vision.score,
      source: "vision",
    };
  }

  // Vision threw, returned malformed, or scored too low — hash-fallback.
  if (vision) {
    log.info(
      { lead_id: input.lead.id, score: vision.score },
      vision.score < MIN_VISION_SCORE ? "vision.low_score" : "vision.invalid_hero",
    );
  }
  const ordered = noRealPhotosOrder(input.lead.id, input.stockPool);
  return {
    hero: ordered[0] ?? "",
    ordered_photos: ordered,
    vision_score: vision?.score ?? 0,
    source: "hash-fallback",
  };
```

- [ ] **Step 3: Extend `web/scripts/check-photo-selector.ts` with Vision-branch cases**

The verification can't actually hit Gemini (would burn API quota every check). Mock it by injecting a fake `selectHeroPhoto`. Add a separate file `web/scripts/check-photo-selector-vision.ts` that uses `module.constructor`-style mocking — OR use Node's `--import` flag. Simplest pattern that matches the existing minimalism: copy-paste the photo-selector logic into the test with a fake `selectHeroPhoto` shim.

Alternative (cleaner) — extract the Vision-branch decision into a pure function and test that.

Add to `web/lib/services/photo-selector.ts`, between `noRealPhotosOrder` and `selectPhotos`:

```ts
/**
 * Pure decision function for the Vision branch — extracted so the verification
 * script can test it without hitting Gemini. Returns the final output given a
 * Vision response (possibly null on failure) and the inputs.
 */
export function decideFromVision(
  visionResult: { hero_url: string; ordered_urls: string[]; score: number } | null,
  input: PhotoSelectorInput,
  candidates: string[],
): PhotoSelectorOutput {
  if (
    visionResult &&
    visionResult.score >= MIN_VISION_SCORE &&
    candidates.includes(visionResult.hero_url)
  ) {
    const used = new Set<string>(visionResult.ordered_urls);
    const padding: string[] = [];
    for (const u of [...candidates, ...input.stockPool]) {
      if (used.has(u)) continue;
      used.add(u);
      padding.push(u);
      if (visionResult.ordered_urls.length + padding.length >= TOTAL_PHOTOS) break;
    }
    const ordered = [...visionResult.ordered_urls, ...padding].slice(0, TOTAL_PHOTOS);
    return {
      hero: visionResult.hero_url,
      ordered_photos: ordered,
      vision_score: visionResult.score,
      source: "vision",
    };
  }
  const ordered = noRealPhotosOrder(input.lead.id, input.stockPool);
  return {
    hero: ordered[0] ?? "",
    ordered_photos: ordered,
    vision_score: visionResult?.score ?? 0,
    source: "hash-fallback",
  };
}
```

Refactor the Vision branch inside `selectPhotos` to call `decideFromVision(vision, input, candidates)`.

Now extend `web/scripts/check-photo-selector.ts` — add at the bottom before the `if (failed > 0)` summary:

```ts
  // ── Vision-branch decisions (mocked Gemini response) ────────────────
  const { decideFromVision } = await import("../lib/services/photo-selector");
  const realA = "https://lh3.googleusercontent.com/real-a";
  const realB = "https://lh3.googleusercontent.com/real-b";
  const visionCandidates = [realA, realB, STOCK_POOL[0], STOCK_POOL[1], STOCK_POOL[2]];

  const baseInput = {
    lead: { id: "11111111-vision-test-2222222222222222", business_name: "Vision Co", category: null },
    niche: "home-services-trades" as const,
    realPhotos: [realA, realB],
    stockPool: STOCK_POOL,
  };

  // (e) High score + valid hero → source=vision, hero matches.
  const r5 = decideFromVision(
    { hero_url: realA, ordered_urls: [realA, realB, STOCK_POOL[0], STOCK_POOL[1]], score: 85 },
    baseInput,
    visionCandidates,
  );
  check("(e) high score → vision branch", r5.source === "vision");
  check("(e) hero matches", r5.hero === realA);
  check("(e) ordered length === 6", r5.ordered_photos.length === 6);

  // (f) Low score → hash fallback even with a hero URL provided.
  const r6 = decideFromVision(
    { hero_url: realA, ordered_urls: [realA, realB], score: 25 },
    baseInput,
    visionCandidates,
  );
  check("(f) low score → fallback", r6.source === "hash-fallback");

  // (g) Vision returned null (e.g. threw) → hash fallback.
  const r7 = decideFromVision(null, baseInput, visionCandidates);
  check("(g) null vision → fallback", r7.source === "hash-fallback");

  // (h) Hero URL not in candidates → fallback (invalid Vision response).
  const r8 = decideFromVision(
    { hero_url: "https://elsewhere.example/x.jpg", ordered_urls: ["https://elsewhere.example/x.jpg"], score: 90 },
    baseInput,
    visionCandidates,
  );
  check("(h) invalid hero → fallback", r8.source === "hash-fallback");
```

- [ ] **Step 4: Run the verification script — verify it PASSES**

```bash
cd web && npx tsx scripts/check-photo-selector.ts
```

Expected: `OK — photo-selector hash-fallback verified.` and no FAIL lines from cases (e)-(h).

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/lib/services/photo-selector.ts web/lib/services/gemini.ts web/scripts/check-photo-selector.ts
git commit -m "feat(photo-selector): Gemini Vision branch + decideFromVision pure fn"
```

---

## Task 6: Photo-aware variant nudge + new niche themes in picker.ts

**Files:**
- Modify: `web/lib/picker.ts` (update `pickTheme` switch, `PHOTOGENIC`/`HIGH_INTENT` arrays, add `usablePhotoCount` gate)

- [ ] **Step 1: Update `pickTheme` to handle all 20 niches**

In `web/lib/picker.ts`, replace the `pickTheme` function body's switch with:

```ts
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
```

- [ ] **Step 2: Update niche-category arrays at the top of pickVariants**

Replace the existing `PROFESSIONAL`, `PHOTOGENIC`, `HIGH_INTENT` arrays with:

```ts
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
];
const HIGH_INTENT: NicheKey[] = [
  "home-services-trades",
  "cleaning-restoration",
  "roofing-exterior",
  "landscaping-outdoor",
  "construction-remodel",
  "automotive",
];
```

- [ ] **Step 3: Add the photo-count gate as a CLAMP at the bottom of pickVariants**

The existing hero selection logic stays. After the final `let hero` assignments and before the return, add:

```ts
  // ── Photo-count clamp ───────────────────────────────────────────────────
  // A hero variant that needs photos shouldn't be picked if the lead has 0
  // usable photos. This catches both pickVariants's own decisions AND any
  // upstream override (Gemini's choice gets clamped the same way before it
  // reaches the template).
  const photosThatNeedImages: Variants["hero"][] = [
    "parallax-photos",
    "full-bleed-photo",
    "split-with-stats",
    "editorial-split",
  ];
  if (photoCount === 0 && photosThatNeedImages.includes(hero)) {
    hero = "animated-gradient";
  }
  if (photoCount < 3 && hero === "parallax-photos") {
    // Parallax needs multiple photos to feel alive; fall back to a single-image hero.
    hero = "full-bleed-photo";
  }
```

- [ ] **Step 4: Export a small clamp helper so stage-3 can apply the same logic to Gemini's pick**

At the bottom of `web/lib/picker.ts`, add:

```ts
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
```

- [ ] **Step 5: Run typecheck**

```bash
cd web && npm run typecheck
```

Expected: clean. If errors persist about old niche key names in other files, search:

```bash
grep -rn '"home-services"\|"landscaping-construction"\|"home-goods-vintage"\|"food-beverage"\|"fitness-pet"\|"beauty-wellness"\|"professional-services"' web/ --include="*.ts" --include="*.tsx"
```

Each match needs migration to the new key set. Likely: zero remaining hits if Tasks 2-3 were thorough.

- [ ] **Step 6: Commit**

```bash
git add web/lib/picker.ts
git commit -m "feat(picker): photo-count clamp + theme mapping for 20 niches"
```

---

## Task 7: Wire photo-selector + cache into stage-3-generate.ts

**Files:**
- Modify: `web/lib/pipeline/stage-3-generate.ts`

- [ ] **Step 1: Extend the `Lead` interface to include the new cache columns**

In `web/lib/pipeline/stage-3-generate.ts`, in the existing `Lead` interface block, add:

```ts
  /** Cache columns from migration 013 — present when a prior selectPhotos
   *  call has already chosen the hero for this lead. */
  hero_photo_url?: string | null;
  photo_order_json?: string[] | null;
  photos_picked_at?: string | null;
```

- [ ] **Step 2: Replace the photo-composition block**

Find the existing block in `web/lib/pipeline/stage-3-generate.ts` (around lines 120-141) that starts with the comment "Photo composition" and contains `STOCK_HEAD`, `MAX_REAL_PHOTOS`, `TOTAL_PHOTOS`. Replace from the comment through the closing `]);` of the `log.info({lead_id, niche, real, stock}, "stage_3.photo_composition")` call with:

```ts
  // ── Photo selection (cached on lead row) ────────────────────────────────
  // First-time builds run Gemini Vision once to choose the hero + order all
  // 6 photo slots. Subsequent rebuilds reuse the cached selection so the
  // demo doesn't visually shuffle between visits. Force-refresh by passing
  // ?refresh-photos=1 to /build or /regenerate (clears the columns before
  // dispatch). See docs/superpowers/specs/2026-05-25-personalized-site-photos-design.md
  const niche = classifyNiche(lead.category ?? null, lead.business_name);
  const stockPool = pickStockPhotosForNiche(niche, 8);  // up to 8; selector slices

  let photos: string[];
  let photoSource: string;

  // Cache hit requires BOTH columns populated — partial state from a
  // half-failed prior write triggers a re-pick.
  const cacheHit = !!(lead.hero_photo_url && lead.photo_order_json && Array.isArray(lead.photo_order_json) && lead.photo_order_json.length > 0);

  if (cacheHit) {
    photos = lead.photo_order_json as string[];
    photoSource = "cache";
    log.info({ lead_id: lead.id, hero: lead.hero_photo_url }, "stage_3.photos_cache_hit");
  } else {
    const rawPhotos = overrides.photos ?? (lead.photos ?? []);
    const realPhotos = await resolvePhotoUrls(rawPhotos, 4);  // MAX_REAL_CANDIDATES = 4
    const selection = await selectPhotos({
      lead: { id: lead.id, business_name: lead.business_name, category: lead.category ?? null },
      niche,
      realPhotos,
      stockPool,
    });
    photos = selection.ordered_photos;
    photoSource = selection.source;
    log.info(
      { lead_id: lead.id, niche, source: selection.source, score: selection.vision_score },
      "stage_3.photos_selected",
    );

    // Persist cache atomically. Single UPDATE writes all three columns;
    // any failure logs but doesn't fail the build — next rebuild re-picks.
    try {
      const { error: cacheErr } = await getDb()
        .from("leads")
        .update({
          hero_photo_url: selection.hero,
          photo_order_json: selection.ordered_photos,
          photos_picked_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
      if (cacheErr) {
        log.warn({ lead_id: lead.id, err: cacheErr.message }, "stage_3.cache_write_failed");
      }
    } catch (cacheErr) {
      log.warn({ lead_id: lead.id, err: String(cacheErr).slice(0, 200) }, "stage_3.cache_write_failed");
    }
  }
```

- [ ] **Step 3: Add the import for `selectPhotos`**

At the top of the file (in the imports block), add:

```ts
import { selectPhotos } from "../services/photo-selector";
```

- [ ] **Step 4: Apply the variant clamp to whichever hero gets picked**

Find the existing block that assigns `variants` (around lines 147-156 — `const variants = ai.variants ?? pickVariants(...)`). Below it, add:

```ts
  // Even if Gemini picked the hero, clamp it to what the photo set can support.
  // pickVariants already self-clamps, but Gemini's response bypasses that.
  variants.hero = clampHeroToPhotos(variants.hero, photos.length);
```

Update the import at the top:

```ts
import { pickVariants, pickTheme, clampHeroToPhotos } from "../picker";
```

- [ ] **Step 5: Remove the now-unused constants**

These three module-level constants in `web/lib/pipeline/stage-3-generate.ts` are orphaned by the rewrite — every usage was inside the block replaced in Step 2. Delete them:

```ts
const MAX_REAL_PHOTOS = 4;
const TOTAL_PHOTOS = 6;
const STOCK_HEAD = 2;
```

The new code already passes literal `4` to `resolvePhotoUrls` and literal `8` to `pickStockPhotosForNiche`, so no other references exist.

- [ ] **Step 6: Run typecheck**

```bash
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 7: Verify the file still loads at module-init via a syntax check**

```bash
npx tsx --eval "import('./lib/pipeline/stage-3-generate.ts').then(() => console.log('ok'))"
```

Run from `web/`. Expected: `ok`.

- [ ] **Step 8: Commit**

```bash
git add web/lib/pipeline/stage-3-generate.ts
git commit -m "feat(stage-3): wire photo-selector + cache, clamp hero to photo count"
```

---

## Task 8: PATCH endpoint accepts new cache columns

**Files:**
- Modify: `web/app/api/leads/[id]/route.ts` (extend `PatchBody` zod schema)

- [ ] **Step 1: Extend the zod schema**

In `web/app/api/leads/[id]/route.ts`, find the `PatchBody` definition (around line 25):

```ts
const PatchBody = z.object({
  email: z.string().email().nullable().optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  stage: z.string().optional(),
  notes: z.string().max(4000).optional(),
  rebuild_started_at: z.null().optional(),
});
```

Replace it with:

```ts
const PatchBody = z.object({
  email: z.string().email().nullable().optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  stage: z.string().optional(),
  notes: z.string().max(4000).optional(),
  rebuild_started_at: z.null().optional(),
  // Photo-selector cache columns. Only `null` is accepted from clients —
  // setting an actual URL is reserved for stage-3-generate. Allowing nulls
  // here lets /build?refresh-photos=1 clear the cache before dispatch.
  hero_photo_url: z.null().optional(),
  photo_order_json: z.null().optional(),
  photos_picked_at: z.null().optional(),
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/leads/[id]/route.ts
git commit -m "api(leads): PATCH accepts null clears for photo cache columns"
```

---

## Task 9: `?refresh-photos=1` cache invalidation in build + regenerate

**Files:**
- Modify: `web/app/api/leads/[id]/build/route.ts`
- Modify: `web/app/api/leads/[id]/regenerate/route.ts`

- [ ] **Step 1: Update `/build/route.ts` to clear cache when the flag is present**

In `web/app/api/leads/[id]/build/route.ts`, immediately after the existing `await getDb().from("leads").update({ rebuild_started_at: ..., last_error: null }).eq("id", params.id);` block (the one added in commit `46de3c4`), add:

```ts
  // Operator forces a fresh photo pick by passing ?refresh-photos=1.
  // Clears the cache columns so stage-3 re-runs the Vision call instead
  // of reusing the prior selection. Useful after Improve adds new photos.
  const refreshPhotos = new URL(req.url).searchParams.get("refresh-photos") === "1";
  if (refreshPhotos) {
    await getDb()
      .from("leads")
      .update({ hero_photo_url: null, photo_order_json: null, photos_picked_at: null })
      .eq("id", params.id);
  }
```

- [ ] **Step 2: Apply the same change to `/regenerate/route.ts`**

In `web/app/api/leads/[id]/regenerate/route.ts`, after the existing `await getDb().from("leads").update({ rebuild_started_at: ..., last_error: null }).eq("id", params.id);` block, add the same conditional clear:

```ts
  const refreshPhotos = new URL(req.url).searchParams.get("refresh-photos") === "1";
  if (refreshPhotos) {
    await getDb()
      .from("leads")
      .update({ hero_photo_url: null, photo_order_json: null, photos_picked_at: null })
      .eq("id", params.id);
  }
```

- [ ] **Step 3: Run typecheck**

```bash
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/leads/[id]/build/route.ts web/app/api/leads/[id]/regenerate/route.ts
git commit -m "api(leads): ?refresh-photos=1 clears photo cache before build/regenerate"
```

---

## Task 10: End-to-end smoke test

**Files:** none changed — manual verification against running services.

**Pre-flight checklist** — these MUST land before any rebuild will use the new code path:

1. **Apply migration 013** to Supabase (`psql "$SUPABASE_URL" -f db/migrations/013_lead_photo_cache.sql` or paste into the SQL editor). Without this, stage-3 catches the missing-column error and silently degrades to no-cache mode.

2. **Deploy the Cloud Run job image.** This is the trap that caught us on the first end-to-end attempt: the dashboard deploys via Vercel on `git push`, but the actual pipeline (stages 2-4) runs on Cloud Run from a Docker image that has to be **rebuilt and redeployed separately**. From repo root:

   ```bash
   gcloud config set project pearl-view-491114
   bash scripts/deploy-cloud-run-job.sh
   ```

   Takes ~3-5 min. The script is idempotent — safe to re-run after every code change that touches anything under `web/lib/pipeline/` or `web/lib/services/`.

3. **Confirm Vercel auto-deployed the dashboard** (UI changes for the new niche names in the dashboard / API contract changes for `PatchBody` + `?refresh-photos=1`). If your project has auto-deploy on `main`, the push from this branch will trigger it.

Once all three are live, proceed to the smoke test below.

- [ ] **Step 1: Run build + start the production server locally**

From the repo root:

```bash
cd web && npm run build && npm start &
sleep 8
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
```

Expected: `HTTP 200`. If `EADDRINUSE`, find and kill the stale process: `netstat -ano | grep ":3000.*LISTENING" | awk '{print $5}' | head -1 | xargs -I{} taskkill //F //PID {}` then retry.

- [ ] **Step 2: Pick three leads from three different niches**

Open `/leads` in the operator dashboard. Note the IDs of three leads that:
- Niche A: a service trades business (plumber / electrician) — verifies `home-services-trades`
- Niche B: an event/styling business (florist / balloon styling) — verifies `event-services` (the bug we set out to fix)
- Niche C: a food/beverage business — verifies `food-restaurants` or `food-cafe-bakery`

If you don't have three suitable leads, run a small batch from the dashboard against curated niches first.

- [ ] **Step 3: For each lead, clear the cache and rebuild**

In a separate terminal:

```bash
# Trigger build with refresh-photos=1 to force a fresh Vision call.
curl -X POST "http://localhost:3000/api/leads/<lead-id-A>/build?refresh-photos=1"
curl -X POST "http://localhost:3000/api/leads/<lead-id-B>/build?refresh-photos=1"
curl -X POST "http://localhost:3000/api/leads/<lead-id-C>/build?refresh-photos=1"
```

Each returns `{"success":true,"data":{"id":"...","status":"building","runner":"local"}}`. Builds take ~30-90s locally.

- [ ] **Step 4: Wait for builds to land, then check the demos**

In the Supabase SQL editor (or via `psql`):

```sql
select id, business_name, stage, hero_photo_url, photos_picked_at, demo_url
  from leads
 where id in ('<id-A>', '<id-B>', '<id-C>')
 order by photos_picked_at desc;
```

Verify:
- All three rows have non-null `hero_photo_url`
- All three `hero_photo_url`s are DIFFERENT URLs
- All three `demo_url`s are populated
- `stage` is `deployed` for all three

- [ ] **Step 5: Open each demo URL in a browser; visually compare the heroes**

Open the three `demo_url`s in three browser tabs. Confirm:
- Each shows a visually distinct hero image
- The event-services lead does NOT show a thrift-store / antique hero
- All three render without layout breakage

- [ ] **Step 6: Run all verification scripts once more**

```bash
cd web && npx tsx scripts/check-niche.ts && npx tsx scripts/check-photo-selector.ts
```

Expected: both print `OK — ...` lines and exit 0.

- [ ] **Step 7: Push the branch**

```bash
git push origin main
```

This goes to your existing main branch. Vercel auto-deploys if configured; otherwise trigger manually per your usual deploy flow.

---

## Done criteria

- [ ] All 10 tasks completed and committed
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npx tsx scripts/check-niche.ts` exits 0
- [ ] `npx tsx scripts/check-photo-selector.ts` exits 0
- [ ] Three demo sites from different niches show three different hero photos
- [ ] The balloon-styling lead does NOT use a Miller-Lite / antique stock photo
- [ ] The cache is populated on `leads.hero_photo_url` / `photo_order_json` / `photos_picked_at` after the first build, and reused (no fresh Vision call) on rebuild without `?refresh-photos=1`
