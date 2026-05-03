/**
 * stock-photos.ts — Niche-keyed Unsplash pools for premium stock imagery.
 *
 * Inputs:  niche key (from lib/niche.classifyNiche) — falls back to template_slug
 * Outputs: array of high-quality Unsplash URLs ready to <img src>
 * Used by: lib/pipeline/stage-3-generate.ts photo composition step
 *
 * Why niche-keyed: the prior single TRADES pool gave salons + estate sales
 * plumbing photos. Photo coherence with the business niche is one of the
 * largest visual quality levers for a cold-demo site.
 *
 * Composition policy (see stage-3-generate.ts):
 *   slots 0–1   → ALWAYS pulled from this pool (premium first-impression shots)
 *   slots 2–N   → real Google photos preferred; fall back to this pool
 *
 * URL format: every entry uses ?w=1600&auto=format&fit=crop&q=80 so Unsplash
 * delivers AVIF/WebP at the requested width. Friendly to PageSpeed.
 *
 * Adding more: only commit IDs you have personally verified resolve via the
 * Unsplash search NAPI. Do not invent photo IDs — Unsplash 404s become broken
 * <img> on every shipped site.
 */
import type { NicheKey } from "../niche";

const PARAMS = "?w=1600&auto=format&fit=crop&q=80";

function url(id: string): string {
  return `https://images.unsplash.com/photo-${id}${PARAMS}`;
}

// Existing trades set (verified). Reused as fallback pool for any niche
// without a curated set yet.
const HOME_SERVICES = [
  url("1581094794329-c8112a89af12"),
  url("1503387762-592deb58ef4e"),
  url("1560185007-c5ca9d2c014d"),
  url("1562259949-e8e7689d7828"),
  url("1607472586893-edb57bdc0e39"),
  url("1585704032915-c3400ca199e7"),
  url("1639303338365-6d5912cd8c56"),
  url("1564334337357-fc93002488ca"),
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

const BEAUTY_WELLNESS = [
  url("1667604946733-c7dd5b992d2e"),
  url("1693578538512-fc66f318c833"),
  url("1760621393386-3906922b0b78"),
  url("1648443524201-8d865e576cae"),
  url("1758789872879-1be800c7bbdb"),
  url("1730367019960-9906d9cbbf05"),
  url("1776482127816-98d2245d22a6"),
  url("1760614034530-a0d34463e03d"),
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

const FITNESS_PET = [
  url("1775993703558-e7afab02b7bd"),
  url("1758448756350-3d0eec02ba37"),
  url("1776710669971-eebdde536700"),
  url("1766031263281-43cdaa6e624a"),
  url("1776710669732-177e69dd582d"),
  url("1761971976003-dc348a4f2fa1"),
  url("1761971975047-6426232852ed"),
  url("1761971975973-cbb3e59263de"),
];

const POOLS: Record<NicheKey, string[]> = {
  "home-services": HOME_SERVICES,
  "landscaping-construction": LANDSCAPING_CONSTRUCTION,
  "beauty-wellness": BEAUTY_WELLNESS,
  "professional-services": PROFESSIONAL_SERVICES,
  "food-beverage": FOOD_BEVERAGE,
  "home-goods-vintage": HOME_GOODS_VINTAGE,
  "real-estate": REAL_ESTATE,
  "fitness-pet": FITNESS_PET,
};

/**
 * Pick `count` stock photos for a niche. Pulls from the head of the pool —
 * deterministic so two leads in the same niche share the same hero shot,
 * but their REAL photos differ enough to keep sites distinct. If the pool
 * is shorter than `count`, falls through to home-services.
 */
export function pickStockPhotosForNiche(niche: NicheKey, count: number): string[] {
  const pool = POOLS[niche] ?? POOLS["home-services"];
  if (pool.length >= count) return pool.slice(0, count);
  // Pool too small — pad from home-services baseline.
  return [...pool, ...POOLS["home-services"].slice(0, count - pool.length)];
}

/**
 * Legacy entry point kept for callers that only know the template_slug.
 * Maps premium-trades / trades to home-services. Prefer pickStockPhotosForNiche
 * when the niche is known (lib/pipeline/stage-3-generate.ts already knows it).
 */
export function pickStockPhotos(_templateSlug: string, count: number): string[] {
  return pickStockPhotosForNiche("home-services", count);
}

export const STOCK_PHOTOS_BY_TEMPLATE: Record<string, string[]> = {
  trades: HOME_SERVICES,
  "premium-trades": HOME_SERVICES,
};
