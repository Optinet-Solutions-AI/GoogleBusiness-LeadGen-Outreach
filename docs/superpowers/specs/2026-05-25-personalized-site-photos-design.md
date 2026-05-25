# Personalized site photos — design

**Date:** 2026-05-25
**Owner:** John (operator)
**Status:** approved, ready for implementation plan
**Scope:** photo selection + niche classification only. Astro components, Gemini copy generation, palette extraction, and outreach/handover flows are out of scope.

---

## 1. Problem

Two demo sites built today on different businesses (Mimi-and-Me Estate Sales in Mobile AL; The Little Things Balloon Garlands & Event Styling in Hamilton NZ) shipped with the **same hero image** — a Miller-Lite stained-glass lamp in a cluttered storage space. The shot is appropriate for an estate seller and absurd for an event-styling business.

Root cause is two compounding policies in [`web/lib/pipeline/stage-3-generate.ts`](web/lib/pipeline/stage-3-generate.ts):

1. **`STOCK_HEAD = 2`** — slots 0–1 of every site's photo array are pulled from a *per-niche* stock pool, never the lead's real Google photos. Hero variants render `data.photos[0]`. Every site in a niche therefore shares slot 0.
2. **Coarse niche bucket `home-goods-vintage`** in [`web/lib/niche.ts`](web/lib/niche.ts) catches `estate ?sale|vintage|antique|home ?good|florist|interior|gift|home ?decor` in one regex. The balloon-styling business has Google category `home_goods_store`, which the matcher normalizes (underscores → spaces) and accepts — so an event-styling business and an antique seller end up using the same Unsplash pool.

The two together produce the "templated copy" feel the operator reported: same niche → same stock pool → same hero photo on every demo.

## 2. Success criteria

- Open two demo URLs side-by-side from different leads. The hero photo is different. If both leads have real Google photos, the heroes show *that business* (or its closest visual proxy). If neither does, both still get distinct stock heroes (no collision inside a niche pool).
- Event styling, antique sellers, furniture stores, and florists no longer share a stock pool.
- One Gemini Vision call per lead lifetime — cached, reused on rebuild.
- No regression on lead detail page, batch detail page, or the rest of the operator dashboard.

## 3. Architecture

Three changes, smallest blast radius first:

```
                stage-3-generate.ts
                        │
   ┌────────────────────┼────────────────────┐
   ↓                    ↓                    ↓
 niche.ts          stock-photos.ts      photo-selector.ts (NEW)
 (8 → ~20            (one pool per         (Gemini Vision ranks
  buckets)            new niche)            real + stock candidates;
                                            cached on lead row)
```

### 3.1 Niche taxonomy — `web/lib/niche.ts`

Expand `NicheKey` from 8 → 20 buckets. The expanded taxonomy:

| Bucket | Captures |
|---|---|
| `home-services-trades` | plumbing, HVAC, electrical, locksmith, pest, appliance, handy, drywall |
| `cleaning-restoration` | carpet clean, water damage, disaster, restoration, junk removal, movers |
| `roofing-exterior` | roof, gutter, siding, stucco, window installer, exterior paint |
| `landscaping-outdoor` | landscape, lawn, garden, tree, arborist, paving, concrete, deck, fence, hardscape |
| `construction-remodel` | construct, remodel, carpenter, excavat, general contractor |
| `automotive` | auto repair, mechanic, body shop, oil change, tire, dealership |
| `beauty-hair-nails` | salon, barber, hair, nail, lash, brow, makeup, wax |
| `spa-massage-wellness` | spa, massage, sauna, holistic, esthetician |
| `fitness-gyms` | gym, fitness, crossfit, yoga, pilates, martial art, personal train |
| `pet-services` | pet, vet, veterinarian, grooming, kennel, dog daycare |
| `food-restaurants` | restaurant, diner, pizzeria, sushi, taco, sandwich, bar and grill |
| `food-cafe-bakery` | cafe, coffee, bakery, donut, ice cream, tea, juice, dessert |
| `food-catering-events` | catering, food truck, private chef |
| `professional-legal-financial` | lawyer, attorney, accountant, cpa, financial, tax, insurance |
| `professional-creative-tech` | marketing agency, advertising, design agency, web design, photographer, video, studio |
| `real-estate` | realtor, broker, property mgmt, leasing, home builder |
| `vintage-antiques-thrift` | estate sale, vintage, antique, thrift, consign, secondhand |
| `home-decor-retail` | furniture, home goods, interior decor, lighting, hardware store |
| `event-services` | balloon, florist, event styling, wedding, party planner, decorator, rental |
| `boutique-gift-retail` | boutique, gift shop, jewelry, accessory, clothing retail |

Rules:
- `MATCHERS` array stays ordered most-specific-first; existing classifier signature unchanged (`classifyNiche(category, businessName)`).
- `home-services-trades` becomes the default fallback (replaces today's `home-services`).
- Underscored Google slugs continue to be normalized (`home_goods_store` → `home goods store`).
- Existing matchers are split, not deleted — every category that hits today still classifies, just into a more specific bucket.

### 3.2 Stock photo pools — `web/lib/data/stock-photos.ts`

One pool per new niche. Each pool: 6-8 hand-verified Unsplash IDs. Hard constraint from the file's existing comment block: every ID must resolve via Unsplash search before it lands in the file (no inventing IDs — they 404 as broken `<img>`s on shipped sites).

The export map `POOL_BY_NICHE: Record<NicheKey, string[]>` adds entries for each new bucket. Pools that aren't fundamentally changing (`food-beverage` carved into `food-restaurants` + `food-cafe-bakery` + `food-catering-events`) can share photos initially; visual-QA iteration will tighten them later.

### 3.3 Photo selector — `web/lib/services/photo-selector.ts` (new)

Single exported function:

```ts
interface PhotoSelectorInput {
  lead: { id: string; business_name: string; category: string | null };
  niche: NicheKey;
  realPhotos: string[];   // already resolved URLs (post-resolvePhotoUrls)
  stockPool: string[];    // top 3-5 from the niche pool
}

interface PhotoSelectorOutput {
  hero: string;
  ordered_photos: string[];   // length === TOTAL_PHOTOS (6)
  vision_score: number;        // 0-100; the model's confidence in `hero`
  source: "vision" | "hash-fallback" | "no-real-photos";
}

async function selectPhotos(input: PhotoSelectorInput): Promise<PhotoSelectorOutput>;
```

Behavior:

1. **No real photos** (`realPhotos.length === 0`): skip Vision entirely. `hero = stockPool[hash(lead.id) % stockPool.length]`, `ordered_photos = [hero, ...stockPool.filter(≠ hero)].slice(0, TOTAL_PHOTOS)`, `source = "no-real-photos"`. Cost: $0.
2. **Has real photos**: one Gemini Vision call (`gemini-2.5-flash`). Prompt passes:
   - Business name + niche bucket
   - Up to 4 real photo URLs (1024px tiles, not full-res — halves token cost with no quality impact on judgement)
   - Exactly the first 3 entries of the niche stock pool (deterministic — same lead-id seed picks the same triple). The whole pool isn't passed because (a) the prompt grows and (b) we want to compare real photos to a small representative set, not exhaustively rank stock.
   - Strict JSON schema response: `{ hero_url: string, ordered_urls: string[], score: number }`
3. **Vision returns a low score (<40)** or throws / parses bad JSON → fall through to the hash-fallback rule above. `source = "hash-fallback"`. Caller sees nothing different.
4. Returned `ordered_photos` always has length exactly `TOTAL_PHOTOS = 6`. If Vision returns fewer, pad from the niche pool (excluding already-used URLs).

The selector reads no DB state. It's pure — `stage-3-generate.ts` is the only caller and is responsible for caching to the lead row.

### 3.4 Photo-aware variant nudge — `web/lib/picker.ts`

`pickVariants` already accepts a photos array. Today it doesn't strongly use length to gate hero variant choice. Add this gate:

- 0 usable photos → bias hero to `animated-gradient` (no photo dependency).
- 1-2 usable photos → bias to `full-bleed-photo`.
- 3+ usable photos → allow `parallax-photos` / `editorial-split`.

"Bias" = exclude the others from the candidate set. Existing `pickVariants` logic that randomizes within candidates is preserved.

Note: Gemini's `ai.variants` still wins when present (per `stage-3-generate.ts:147-156`). The photo-aware nudge only affects `pickVariants` fallback. To respect photo reality even when Gemini picks, after Gemini returns we apply the same gate as a *clamp*: if Gemini picked `parallax-photos` but we have 0 usable photos, force to `animated-gradient`. This is a 5-line guard, not a rewrite.

### 3.5 Cache on lead row

New columns on `leads`:

```sql
ALTER TABLE leads ADD COLUMN hero_photo_url    text;
ALTER TABLE leads ADD COLUMN photo_order_json  jsonb;
ALTER TABLE leads ADD COLUMN photos_picked_at  timestamptz;
```

Migration lives at `db/migrations/013_lead_photo_cache.sql` (existing migrations run 001-012, skipping 007). Applied by the operator the same way other migrations are applied (`psql "$SUPABASE_URL" -f …`).

`stage-3-generate.ts` flow:

```
1. Read lead. Cache hit requires BOTH hero_photo_url AND photo_order_json
   present (partial state from a half-failed prior write → re-pick).
   If hit: use cached values, skip selector entirely (no Vision call, $0).
2. Else:
     • Resolve real photo URLs (existing resolvePhotoUrls — unchanged).
     • Pass first 3 entries of niche stock pool as candidates.
     • Call selectPhotos(...).
     • Write hero_photo_url + photo_order_json + photos_picked_at in a
       single UPDATE (atomic — either all three land or none do).
3. Build data.json with photos = ordered_photos[0..5].
4. Continue to npm run build + deploy as today.
```

Force re-pick:
- Operator can pass `?refresh-photos=1` to `/api/leads/:id/build` or `/api/leads/:id/regenerate`. The route clears `hero_photo_url + photo_order_json + photos_picked_at` before dispatching. Used when the operator added new photos via Improve and wants a fresh pick.

## 4. Data flow

```
operator clicks Build
        ↓
POST /api/leads/:id/build   (sets rebuild_started_at)
        ↓
Cloud Run job: buildLead(:id)
        ↓
stage-2-enrich               (unchanged; resolves photos, brand color)
        ↓
stage-3-generate:
  • classifyNiche(...)        ← expanded buckets
  • resolvePhotoUrls(...)     ← unchanged
  • IF leads.hero_photo_url:
      use cached
    ELSE:
      photo-selector.selectPhotos(...)  ← new, single Vision call (cached)
      write cache to lead row
  • pickVariants(...)         ← photo-aware nudge added
  • write data.json
  • npm run build
        ↓
stage-4-deploy               (unchanged)
```

## 5. Error handling

| Failure | Handling |
|---|---|
| Gemini Vision throws | Catch, log `stage_3.vision.failed`, fall through to hash-fallback. Lead still builds. |
| Vision returns malformed JSON | Same as above. |
| Vision returns score <40 | Hash-fallback. Logged at `info` level (`stage_3.vision.low_score`). |
| Real photo URL 404s post-pick | Photo selector already only sees resolved URLs — if Places Photo API returned a URL, we trust it. If the browser later fails to load, that's the same blank-image-on-card problem the site has today; out of scope. |
| Cache write fails (Supabase error) | Don't fail the build. Log `stage_3.cache_write_failed`. Vision call cost is sunk; next rebuild will re-pick. |
| `photo_order_json` column missing (operator didn't run migration) | Selector still runs; cache writes are wrapped in try/catch. The migration is required for caching to take effect, but the build succeeds without it. |

## 6. Cost ceiling

| Scale | Vision calls (with cache) | Monthly cost |
|---|---|---|
| 100 builds/mo | ~100 first-time + ~20 rebuilds (cached) | < $0.10 |
| 500 builds/mo | ~500 + ~100 rebuilds | ~$0.40 |
| 2000 builds/mo | ~2000 + ~400 rebuilds | ~$1.60 |

Per-call: ~$0.0002 – $0.0008 at `gemini-2.5-flash` paid rates. Free tier covers up to ~500 builds/day on top of the existing copy + visual-QA calls. Adds at most ~1.6% to the existing $0.05/site generation cost.

## 7. Testing

- Unit: `niche.test.ts` — expand the existing table-driven tests with cases for each new bucket. Include the two failing real-world inputs that motivated this work (Mimi & Me Estate Sales → `vintage-antiques-thrift`; The Little Things Balloon Garlands → `event-services`).
- Unit: `photo-selector.test.ts` — mock the Gemini client. Verify: (a) no-real-photos path skips Vision, (b) hash determinism (same lead.id → same fallback pick), (c) low-score path falls back, (d) parse-error path falls back.
- Integration: build one lead from each of three niches end-to-end on a local dev machine; confirm three distinct hero photos.
- Visual: spot-check two lead detail pages in the operator dashboard — verify the demo iframe still loads, alt text isn't broken.

## 8. Out of scope (defer to separate increments)

- **Logo cleanup pass** — Gemini Vision crops + transparent-bg's the Google logo (often a blurry storefront photo). +1 Vision call/lead, ~$0.0005.
- **Per-photo alt-text generation** — Gemini writes descriptive alt for each used photo. +1 Flash call. ~$0.0001.
- **Background blur on bad photos** — instead of dropping a tilted/dark photo, render it as a blurred ambient backdrop. Local CSS, $0. Likely worth doing soon but needs its own design pass.
- **Astro template changes** — variant components, layout tweaks. Independent surface.

These are flagged so they're not forgotten; they each warrant their own design pass.
