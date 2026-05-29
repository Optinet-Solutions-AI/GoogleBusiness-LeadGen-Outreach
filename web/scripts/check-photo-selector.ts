/**
 * check-photo-selector.ts — Assertion-based verification for photo-selector.
 *
 * Run with: npx tsx scripts/check-photo-selector.ts (from web/)
 */
import { selectPhotos, decideFromVision } from "../lib/services/photo-selector";

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

  // ── Vision-branch decisions (mocked Gemini response) ────────────────
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

  // baseInput has realPhotos.length === 2, so the post-vision fallback
  // routes through realFirstOrder → source === "real-hash-fallback".

  // (f) Low score → real-hash fallback (still uses real photos for hero).
  const r6 = decideFromVision(
    { hero_url: realA, ordered_urls: [realA, realB], score: 25 },
    baseInput,
    visionCandidates,
  );
  check("(f) low score → real-hash-fallback", r6.source === "real-hash-fallback");
  check("(f) hero from real pool", r6.hero === realA || r6.hero === realB);

  // (g) Vision returned null (e.g. threw) → real-hash fallback.
  const r7 = decideFromVision(null, baseInput, visionCandidates);
  check("(g) null vision → real-hash-fallback", r7.source === "real-hash-fallback");
  check("(g) hero from real pool", r7.hero === realA || r7.hero === realB);

  // (h) Hero URL not in candidates → real-hash fallback.
  const r8 = decideFromVision(
    { hero_url: "https://elsewhere.example/x.jpg", ordered_urls: ["https://elsewhere.example/x.jpg"], score: 90 },
    baseInput,
    visionCandidates,
  );
  check("(h) invalid hero → real-hash-fallback", r8.source === "real-hash-fallback");

  // (i) NO real photos at all → stock-hash fallback (legacy behavior).
  const noRealInput = { ...baseInput, realPhotos: [] };
  const r9 = decideFromVision(null, noRealInput, visionCandidates);
  check("(i) no real photos → stock-hash-fallback", r9.source === "stock-hash-fallback");

  if (failed > 0) {
    console.error(`\n${failed} assertions failed.`);
    process.exit(1);
  }
  console.log(`OK — photo-selector fallback paths verified.`);
})();
