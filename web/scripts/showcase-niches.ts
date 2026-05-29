/**
 * showcase-niches.ts — Generate one demo site per niche so the template
 * can be evaluated across every classifyNiche() bucket. Synthetic leads
 * with realistic-but-obviously-fake business names; no real photos so
 * each site exercises the niche stock-photo pool.
 *
 * Usage:  npx tsx scripts/showcase-niches.ts
 *
 * Cost:   ~40 Gemini calls (2 per lead × 20 leads), well under the free
 *         tier's 1,500/day. ~25 min wall clock at 5-parallel.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });
import { createClient } from "@supabase/supabase-js";

const API = "https://google-business-lead-gen-outreach.vercel.app/api/leads";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// 20 synthetic leads, one per NicheKey in web/lib/niche.ts. The `category`
// strings are chosen to hit each MATCHERS regex specifically so the
// pipeline lands on the intended niche. Business names + cities chosen
// for variety so the deployed showcase doesn't read as 20 copies.
const SHOWCASE: Array<{
  niche: string;
  business_name: string;
  category: string;
  address: string;
  rating: number;
  review_count: number;
  is_service_area_only?: boolean;
}> = [
  { niche: "event-services",               business_name: "Showcase · Bloom & Balloon Co",     category: "Event stylist",            address: "12 Magnolia Ln, Charleston, SC 29401",     rating: 4.9, review_count: 87 },
  { niche: "vintage-antiques-thrift",      business_name: "Showcase · The Curated Estate",     category: "Antique dealer",           address: "44 River St, Savannah, GA 31401",          rating: 4.8, review_count: 62 },
  { niche: "home-decor-retail",            business_name: "Showcase · Hearth & Home Goods",    category: "Home goods store",         address: "108 Biltmore Ave, Asheville, NC 28801",    rating: 4.7, review_count: 134 },
  { niche: "boutique-gift-retail",         business_name: "Showcase · Olive Lane Boutique",    category: "Boutique",                 address: "215 Bedford Ave, Brooklyn, NY 11211",      rating: 4.8, review_count: 96 },
  { niche: "real-estate",                  business_name: "Showcase · Anchor Realty Group",    category: "Real estate agency",       address: "60 West St, Annapolis, MD 21401",          rating: 4.9, review_count: 218 },
  { niche: "beauty-hair-nails",            business_name: "Showcase · Iris Hair Salon",        category: "Hair salon",               address: "300 Lake Ave, Pasadena, CA 91101",         rating: 4.9, review_count: 412 },
  { niche: "spa-massage-wellness",         business_name: "Showcase · Stillwater Spa",         category: "Massage spa",              address: "5 Canyon Rd, Sedona, AZ 86336",            rating: 5.0, review_count: 88 },
  { niche: "fitness-gyms",                 business_name: "Showcase · Forge Strength Gym",     category: "Gym",                      address: "1450 Pearl St, Boulder, CO 80302",         rating: 4.8, review_count: 271 },
  { niche: "pet-services",                 business_name: "Showcase · Whisker & Wag",          category: "Pet grooming",             address: "722 State St, Madison, WI 53703",          rating: 4.9, review_count: 156 },
  { niche: "food-catering-events",         business_name: "Showcase · Stonefire Catering",     category: "Catering company",         address: "10 North St, Healdsburg, CA 95448",        rating: 4.9, review_count: 64 },
  { niche: "food-cafe-bakery",             business_name: "Showcase · Hazel & Crumb Bakery",   category: "Bakery",                   address: "1600 NW 23rd, Portland, OR 97210",         rating: 4.8, review_count: 392 },
  { niche: "food-restaurants",             business_name: "Showcase · Copper Lantern",         category: "Restaurant",               address: "82 Market St, Charleston, SC 29401",       rating: 4.7, review_count: 528 },
  { niche: "automotive",                   business_name: "Showcase · Highway 1 Auto Repair",  category: "Auto repair shop",         address: "455 Cannery Row, Monterey, CA 93940",      rating: 4.8, review_count: 203 },
  { niche: "professional-creative-tech",   business_name: "Showcase · Northbound Design Studio", category: "Design agency",         address: "55 Greenpoint Ave, Brooklyn, NY 11222",    rating: 5.0, review_count: 48 },
  { niche: "professional-legal-financial", business_name: "Showcase · Bridgepoint Law Firm",   category: "Law firm",                 address: "200 Beacon St, Boston, MA 02116",          rating: 4.9, review_count: 156 },
  { niche: "roofing-exterior",             business_name: "Showcase · Summit Roofing Co",      category: "Roofing contractor",       address: "1900 Wewatta St, Denver, CO 80202",        rating: 4.8, review_count: 187 },
  { niche: "landscaping-outdoor",          business_name: "Showcase · Greenstone Landscaping", category: "Landscaping contractor",   address: "3200 SE Division, Portland, OR 97202",     rating: 4.9, review_count: 142 },
  { niche: "construction-remodel",         business_name: "Showcase · Foundry Remodel Group",  category: "General contractor",       address: "1180 S Lamar Blvd, Austin, TX 78704",      rating: 4.8, review_count: 96 },
  { niche: "cleaning-restoration",         business_name: "Showcase · Bright Path Cleaning",   category: "Cleaning service",         address: "401 N Washington Ave, Minneapolis, MN 55401", rating: 4.9, review_count: 318, is_service_area_only: true },
  { niche: "home-services-trades",         business_name: "Showcase · Premier Plumbing Co",    category: "Plumber",                  address: "2110 E 7th St, Austin, TX 78702",          rating: 4.8, review_count: 245 },
  // Entertainment — added after first round of validation. Venues
  // anchor on a fixed address (escape room, bowling), services
  // travel TO events (DJ, kids entertainer) so they get
  // is_service_area_only=true.
  { niche: "entertainment-venues",         business_name: "Showcase · Lumen Escape Rooms",      category: "Escape room",              address: "417 N Robertson Blvd, West Hollywood, CA 90069", rating: 4.9, review_count: 312 },
  { niche: "entertainment-services",       business_name: "Showcase · Nightshift DJ Co",        category: "Wedding DJ",               address: "1300 Wynkoop St, Denver, CO 80202",        rating: 5.0, review_count: 178, is_service_area_only: true },
];

// 5 concurrent regens at a time. Gemini free tier is 15 RPM; each lead
// makes ~2 Gemini calls 30s apart, so 5 in flight = ~10 calls / minute,
// safely under the limit. Going wider (10+) risks 429 throttling.
const PARALLEL_PER_WAVE = 5;
const POLL_INTERVAL_MS = 25_000;
const MAX_WAIT_MS = 15 * 60 * 1000;

interface PreparedLead { id: string; spec: typeof SHOWCASE[number]; baseline_demo: string | null; }

async function getOrCreateShowcaseBatch(): Promise<string> {
  // Reuse an existing showcase batch if present so re-runs don't pile
  // them up. Filter by template_slug + niche tag.
  const { data: existing } = await db
    .from("batches")
    .select("id")
    .eq("niche", "showcase-all")
    .eq("template_slug", "premium-trades")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data, error } = await db
    .from("batches")
    .insert({
      niche: "showcase-all",
      city: "Various",
      template_slug: "premium-trades",
      scraper: "google_places",
      limit: SHOWCASE.length,
      status: "done",
      estimated_cost_usd: 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`batch create failed: ${error?.message}`);
  return data.id as string;
}

async function upsertLead(batchId: string, spec: typeof SHOWCASE[number]): Promise<PreparedLead> {
  // Match on business_name to make this idempotent — re-running the
  // script reuses the existing showcase rows (and their cached photo
  // selections) rather than creating duplicates.
  const { data: existing } = await db
    .from("leads")
    .select("id, demo_url")
    .eq("business_name", spec.business_name)
    .maybeSingle();
  if (existing?.id) {
    // Clear photo cache so each rerun picks fresh from the niche pool
    // (in case POOL_BY_NICHE expanded since last run).
    await db
      .from("leads")
      .update({
        hero_photo_url: null,
        photo_order_json: null,
        photos_picked_at: null,
        category: spec.category,
        address: spec.address,
        rating: spec.rating,
        review_count: spec.review_count,
        is_service_area_only: spec.is_service_area_only ?? false,
        stage: "enriched",
        last_error: null,
      })
      .eq("id", existing.id);
    return { id: existing.id as string, spec, baseline_demo: (existing.demo_url as string) ?? null };
  }
  const { data, error } = await db
    .from("leads")
    .insert({
      batch_id: batchId,
      business_name: spec.business_name,
      category: spec.category,
      address: spec.address,
      rating: spec.rating,
      review_count: spec.review_count,
      has_website: false,
      stage: "enriched",
      photos: [],
      reviews: [],
      is_service_area_only: spec.is_service_area_only ?? false,
      brand_color: "#3b3b3b",
    })
    .select("id, demo_url")
    .single();
  if (error || !data) throw new Error(`lead insert failed for ${spec.business_name}: ${error?.message}`);
  return { id: data.id as string, spec, baseline_demo: (data.demo_url as string) ?? null };
}

async function triggerRegenerate(leadId: string): Promise<boolean> {
  const res = await fetch(`${API}/${leadId}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_stage: "generate" }),
  });
  if (!res.ok) {
    console.error(`  ${leadId}: trigger HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
    return false;
  }
  return true;
}

async function waitForDemo(p: PreparedLead): Promise<{ url: string | null; error: string | null }> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const { data, error } = await db
      .from("leads")
      .select("demo_url, last_error")
      .eq("id", p.id)
      .single();
    if (error) return { url: null, error: error.message };
    if (data?.last_error) return { url: null, error: data.last_error as string };
    if (data?.demo_url && data.demo_url !== p.baseline_demo) {
      return { url: data.demo_url as string, error: null };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { url: null, error: "timeout >15min" };
}

async function runWave(wave: PreparedLead[]): Promise<Array<{ lead: PreparedLead; url: string | null; error: string | null }>> {
  console.log(`\n--- wave of ${wave.length}: ${wave.map((p) => p.spec.niche).join(", ")} ---`);
  // Fire all triggers in parallel, then poll all in parallel.
  await Promise.all(wave.map(async (p) => {
    const ok = await triggerRegenerate(p.id);
    console.log(`  ${p.spec.niche.padEnd(32)} triggered: ${ok ? "ok" : "FAIL"}`);
  }));
  return Promise.all(
    wave.map(async (p) => {
      const result = await waitForDemo(p);
      const status = result.url
        ? `→ ${result.url}`
        : `! ${result.error}`;
      console.log(`  ${p.spec.niche.padEnd(32)} ${status}`);
      return { lead: p, ...result };
    }),
  );
}

async function main() {
  console.log(`Showcase generation: ${SHOWCASE.length} niches, ${PARALLEL_PER_WAVE} parallel\n`);
  const batchId = await getOrCreateShowcaseBatch();
  console.log(`batch_id: ${batchId}`);

  console.log("\n-- prepping rows --");
  const prepared: PreparedLead[] = [];
  for (const spec of SHOWCASE) {
    const lead = await upsertLead(batchId, spec);
    prepared.push(lead);
    console.log(`  ${spec.niche.padEnd(32)} ${lead.id.slice(0, 8)}  baseline=${lead.baseline_demo ?? "(new)"}`);
  }

  const results: Array<{ lead: PreparedLead; url: string | null; error: string | null }> = [];
  for (let i = 0; i < prepared.length; i += PARALLEL_PER_WAVE) {
    const wave = prepared.slice(i, i + PARALLEL_PER_WAVE);
    const r = await runWave(wave);
    results.push(...r);
  }

  // Summary
  console.log("\n\n======== SUMMARY ========");
  const ok = results.filter((r) => r.url);
  const failed = results.filter((r) => !r.url);
  console.log(`success: ${ok.length}/${results.length}`);
  if (failed.length) {
    console.log("\nfailures:");
    for (const f of failed) console.log(`  ${f.lead.spec.niche.padEnd(32)} ${f.error}`);
  }
  console.log("\nlive URLs by niche:");
  for (const r of results) {
    console.log(`  ${r.lead.spec.niche.padEnd(32)} ${r.url ?? "(failed)"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
