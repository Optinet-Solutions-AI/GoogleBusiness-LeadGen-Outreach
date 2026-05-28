/**
 * stage-3-generate.ts — Build a personalized multi-page site for one lead.
 *
 * Inputs:  lead row at stage='enriched', batch.template_slug
 * Outputs: built site at `.tmp/generated-sites/<lead_slug>/dist/`,
 *          lead.stage='generated'
 * Used by: lib/pipeline/orchestrator.ts, lib/pipeline/improve.ts
 *
 * Steps:
 *   1. Call Gemini for site copy (home/about/per-service/service-area/contact).
 *   2. Materialize a `data.json` the Astro template reads at build time.
 *   3. `npm install` (first time only) + `npm run build` in templates/<slug>/.
 *   4. Copy `dist/` into `.tmp/generated-sites/<slug>/dist/`.
 *
 * Cost: Gemini free tier covers the pilot. Confirm before regenerating in bulk.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pickStockPhotosForNiche, cachedPhotosMatchNiche } from "../data/stock-photos";
import { getDb } from "../db";
import { getLogger } from "../logger";
import { classifyNiche } from "../niche";
import { derivePalette } from "../palette";
import { pickVariants, pickTheme, clampHeroToPhotos, type Variants } from "../picker";
import { selectPhotos } from "../services/photo-selector";
import * as googlePlaces from "../services/google-places";
import { generateSiteData } from "../services/gemini";
import type { AiSiteData, SiteCopy } from "../services/gemini";
import { slugify } from "../slugify";


const log = getLogger("stage-3");

const REPO_ROOT = path.resolve(process.cwd(), "..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".tmp", "generated-sites");

export interface Lead {
  id: string;
  business_name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
  photos?: Array<unknown>;
  reviews?: Array<unknown>;
  category?: string | null;
  rating?: number | null;
  review_count?: number | null;
  service_areas?: string[];          // optional, post-improve enrichment
  business_hours?: Record<string, string>;
  is_service_area_only?: boolean | null;
  /** Cache columns from migration 013 — present when a prior selectPhotos
   *  call has already chosen the hero for this lead. */
  hero_photo_url?: string | null;
  photo_order_json?: string[] | null;
  photos_picked_at?: string | null;
}

export interface OverrideCopy extends Partial<SiteCopy> {
  // operator can hand-edit any subset of generated copy
}

export async function run(
  lead: Lead,
  templateSlug: string,
  overrides: { copy?: OverrideCopy; photos?: string[] } = {},
): Promise<string> {
  // Resolve the template directory. Niches without a dedicated template
  // (food-beverage / beauty-wellness / professional-services / real-estate)
  // fall back to premium-trades — it's our highest-quality generic template
  // and produces a far better demo than the legacy 'trades' template did.
  // Trying 'trades' as a last-resort second fallback in case premium-trades
  // is missing on an outdated Cloud Run image.
  const FALLBACKS = ["premium-trades", "trades"] as const;
  let resolvedSlug = templateSlug;
  let templateDir = path.join(TEMPLATES_DIR, resolvedSlug);
  if (!(await exists(templateDir))) {
    let fellBackTo: string | null = null;
    for (const candidate of FALLBACKS) {
      const dir = path.join(TEMPLATES_DIR, candidate);
      if (await exists(dir)) {
        resolvedSlug = candidate;
        templateDir = dir;
        fellBackTo = candidate;
        break;
      }
    }
    if (!fellBackTo) {
      throw new Error(
        `Template '${templateSlug}' missing and no fallback exists under ${TEMPLATES_DIR}`,
      );
    }
    log.warn(
      { lead_id: lead.id, requested: templateSlug, fallback: fellBackTo },
      "stage_3.template_missing_fallback",
    );
  }
  log.info({ lead_id: lead.id, template: resolvedSlug }, "stage_3.start");

  // ── Variant diversity hint ─────────────────────────────────────────────
  // Two leads in the same niche shouldn't ship identical variant combos
  // (same hero + services + reviews + trust = "template behind paraphrased
  // copy"). Pull what the most-recent 5 same-niche leads used, then pass
  // that as an "avoid if other good fits exist" hint to both Gemini's
  // strategy pass AND pickVariants's deterministic fallback.
  const avoidVariants = await fetchRecentNicheVariants(lead.id, lead.category, lead.business_name);

  const ai: AiSiteData = await generateSiteData({
    business_name: lead.business_name,
    category: lead.category ?? null,
    address: lead.address ?? null,
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    reviews: lead.reviews ?? [],
    business_hours: lead.business_hours ?? null,
    service_areas_hints: lead.service_areas ?? [],
    avoid_variants: avoidVariants,
  });

  // Operator-supplied copy overrides win over AI output.
  const copy: SiteCopy = { ...ai.copy, ...(overrides.copy ?? {}) } as SiteCopy;

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
  //
  // ALSO invalidate the cache when any photo in photo_order_json comes
  // from a stock pool that doesn't match the lead's CURRENT niche. We
  // were shipping leads with stale stock photos from an earlier niche
  // classification — e.g. a balloon-styling lead whose photo cache was
  // set when the same row was classified as home-services, leaving
  // plumbing photos on the service cards months later. This guard
  // forces a re-pick whenever the niche/stock-pool relationship has
  // drifted, even if `?refresh-photos=1` wasn't passed.
  const cacheHit =
    !!lead.hero_photo_url &&
    !!lead.photo_order_json &&
    Array.isArray(lead.photo_order_json) &&
    lead.photo_order_json.length > 0 &&
    cachedPhotosMatchNiche(lead.photo_order_json as string[], niche);

  if (
    !cacheHit &&
    lead.hero_photo_url &&
    lead.photo_order_json &&
    Array.isArray(lead.photo_order_json) &&
    lead.photo_order_json.length > 0
  ) {
    log.info(
      { lead_id: lead.id, niche, cached: (lead.photo_order_json as string[]).length },
      "stage_3.photo_cache_invalidated_wrong_niche",
    );
  }

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

  // Palette source-of-truth:
  //
  // When the lead has a real logo (we successfully scraped a JPG/PNG from
  // FB / IG / Brandfetch and persisted it as a data URI), the brand color
  // we extracted from those bytes IS the brand. Lock the palette to it
  // via derivePalette — Gemini's palette guess will systematically drift
  // toward the trades default (navy + orange) regardless of niche because
  // its prompt doesn't see the real logo. Locking here keeps the rendered
  // theme visually faithful to the actual brand identity.
  //
  // Falls through to AI / fallback when the logo is a monogram SVG (no
  // real bytes to derive from) — AI's choice is then the best signal we
  // have.
  const hasRealLogo =
    typeof lead.logo_url === "string" &&
    /^data:image\/(jpe?g|png|webp|gif)/i.test(lead.logo_url);
  const palette = hasRealLogo
    ? derivePalette(lead.brand_color)
    : ai.palette ?? derivePalette(lead.brand_color);
  // Pick variants from AI first, then enforce diversity. AI's choice is
  // the art-director signal we want by default — but when it lands on a
  // value that's already in the avoid set for a slot, the post-process
  // swaps it for the picker's fallback. That guarantees the cross-lead
  // diversity even when Gemini's avoid hint doesn't take, while still
  // letting AI lead on the easy cases.
  // AI's variants schema doesn't include service_detail_offset (it's a
  // deterministic diversity dial picked by stage-3, not a creative
  // choice). When AI supplies variants, splice in the picker-provided
  // offset so the rotation logic in pages/services/[slug].astro has a
  // value to read.
  const pickerVariants = pickVariants({
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    photos,
    trust_strip: copy.trust_strip,
    category: lead.category ?? null,
    niche,
    // service_area + is_service_area_only inform service_area + about
    // picks. About also leans on photoCount; service-area routing
    // distinguishes radius-card (mobile) from city-mosaic (photogenic)
    // from map-pin-cards (many areas) from map-editorial (default).
    service_areas_count:
      (lead.service_areas?.length ?? 0) ||
      (ai.service_areas?.length ?? 0),
    is_service_area_only: lead.is_service_area_only ?? false,
    avoid: avoidVariants,
  });
  const initialVariants = ai.variants
    ? { ...ai.variants, service_detail_offset: pickerVariants.service_detail_offset }
    : pickerVariants;
  // Reuse pickerVariants as the fallback source — even when AI supplied
  // variants, the diversity-aware picker provides the fallback choices.
  const variants = enforceDiversity(initialVariants, pickerVariants, avoidVariants);
  if (JSON.stringify(variants) !== JSON.stringify(initialVariants)) {
    log.info(
      { lead_id: lead.id, initial: initialVariants, enforced: variants, avoid: avoidVariants },
      "stage_3.diversity.enforced",
    );
  }

  // Even if Gemini picked the hero, clamp it to what the photo set can support.
  // pickVariants already self-clamps, but Gemini's response bypasses that.
  variants.hero = clampHeroToPhotos(variants.hero, photos.length);

  // Theme — Gemini's pick wins; pickTheme is the niche-aware fallback when
  // the AI response is missing the field (older models / schema drift).
  const theme = ai.theme ?? pickTheme(niche);

  // Merge: DB facts win when present, AI fallbacks fill the gaps.
  const dbReviews = (lead.reviews ?? []) as Array<unknown>;
  const reviews = dbReviews.length > 0 ? dbReviews.slice(0, 6) : (ai.reviews ?? []).slice(0, 6);

  // Clamp reviews variant to the actual review set. Gemini regularly picks
  // "marquee" even when the lead only has 3 reviews — the marquee then
  // duplicates each card to fill the scrolling row, so you literally see
  // the same testimonial twice on screen at once. Force the lighter
  // variants when content density is low.
  const usableReviewCount = (reviews as Array<{ text?: string }>)
    .filter((r) => typeof r?.text === "string" && r.text.length > 20).length;
  if (variants.reviews === "marquee" && usableReviewCount < 6) {
    variants.reviews = usableReviewCount < 3 ? "single-featured" : "masonry-grid";
  }
  const service_areas =
    lead.service_areas && lead.service_areas.length > 0
      ? lead.service_areas
      : ai.service_areas ?? [];
  const business_hours = lead.business_hours ?? ai.business_hours ?? null;

  const siteData = {
    business_name: lead.business_name,
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    address: lead.address ?? null,
    category: lead.category ?? null,
    niche,  // drives [data-niche] CSS overrides in global.css
    brand_color: ai.brand_color ?? lead.brand_color ?? palette.primary,
    palette,
    variants,
    theme,
    photos,
    reviews,
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    business_hours,
    service_areas,
    logo_url: lead.logo_url ?? null,
    is_service_area_only: lead.is_service_area_only ?? false,
    copy,
  };

  const slug = slugify(lead.business_name);
  const outDir = path.join(OUTPUT_ROOT, slug);
  await fs.mkdir(outDir, { recursive: true });

  const dataPath = path.join(templateDir, "src", "data.json");
  await fs.writeFile(dataPath, JSON.stringify(siteData, null, 2), "utf-8");

  const nodeModules = path.join(templateDir, "node_modules");
  if (!(await exists(nodeModules))) {
    log.info({ template: templateSlug }, "stage_3.npm_install");
    await runCmd("npm", ["install"], templateDir);
  }
  log.info({ slug }, "stage_3.build");
  // Pass the canonical project URL so Astro.site resolves correctly per-site
  // (drives canonical / sitemap / og:url / JSON-LD @id values). Cloudflare
  // Pages serves the project at <slug>.pages.dev — the per-deploy hash URL
  // is preview-only, the bare project URL is what we want for SEO.
  await runCmd("npm", ["run", "build"], templateDir, {
    SITE_URL: `https://${slug}.pages.dev`,
  });

  const distSrc = path.join(templateDir, "dist");
  const distDest = path.join(outDir, "dist");
  await fs.rm(distDest, { recursive: true, force: true });
  await fs.cp(distSrc, distDest, { recursive: true });

  // Write the stage + variants. If `variants` column hasn't been
  // created yet (migration 015 not applied), retry the update without
  // it so we don't lose the deploy at the very last step. Diversity
  // diagnostic stays in the logs even when persistence is unavailable.
  let persistErr = (await getDb()
    .from("leads")
    .update({ stage: "generated", variants })
    .eq("id", lead.id)).error;
  if (persistErr && /column .*variants/i.test(persistErr.message)) {
    log.warn(
      { lead_id: lead.id, hint: "run db/migrations/015_lead_variants.sql" },
      "stage_3.variants_column_missing.persisting_stage_only",
    );
    persistErr = (await getDb()
      .from("leads")
      .update({ stage: "generated" })
      .eq("id", lead.id)).error;
  }
  if (persistErr) throw new Error(`stage_3.persist.error: ${persistErr.message}`);

  log.info({ lead_id: lead.id, dist: distDest, variants }, "stage_3.done");
  return distDest;
}

/**
 * Pull variant combinations from the most-recent 5 leads in the same
 * niche as this lead. Output is the shape the picker + Gemini expect:
 * one array of "already-used" values per slot. Excludes the current
 * lead so a regenerate doesn't see its own prior pick as something
 * to avoid.
 *
 * Soft-failures: any DB or schema issue returns an empty avoid set,
 * which the downstream callers treat as "no constraint" — diversity
 * is a nice-to-have, never a build blocker.
 */
/**
 * Hard-enforce variant diversity: walk each slot in the initial pick
 * (AI's or the picker's), and if the value is in the avoid set for
 * that slot, swap to the fallback pick for the same slot. Acts as
 * the last line of defence so two same-niche leads can't share
 * variants no matter what Gemini chose.
 *
 * The fallback is itself diversity-aware (pickVariants walks each
 * slot's per-variant fallback chain), so the swap-in is the
 * next-best option, not a uniform default.
 */
function enforceDiversity(
  initial: Variants,
  fallback: Variants,
  avoid: Record<string, string[]>,
): Variants {
  const out: Variants = { ...initial };
  const slots: (keyof Variants)[] = [
    "hero",
    "services",
    "reviews",
    "trust",
    "about",
    "service_area",
    "cta",
  ];
  for (const slot of slots) {
    const banned = avoid[slot];
    if (!banned?.length) continue;
    const current = out[slot] as string;
    // "hidden" reviews/trust aren't structural duplicates — same-niche
    // leads with no reviews can all be `hidden` without looking similar.
    if (current === "hidden") continue;
    if (banned.includes(current)) {
      const alt = fallback[slot] as string;
      if (alt && alt !== current && !banned.includes(alt)) {
        (out[slot] as string) = alt;
      }
      // If even the fallback is in the avoid set, leave the initial
      // pick. Means the avoid set has saturated the available enum —
      // very rare with 5-6 options per slot.
    }
  }
  return out;
}

async function fetchRecentNicheVariants(
  selfLeadId: string,
  category: string | null | undefined,
  businessName: string,
): Promise<{
  hero?: string[];
  services?: string[];
  reviews?: string[];
  trust?: string[];
  about?: string[];
  service_area?: string[];
  cta?: string[];
  /** Stored as string[] for uniformity; service_detail_offset is a number
   *  but we serialize it the same way so enforceDiversity walks one slot
   *  list shape. picker.ts parses back to int. */
  service_detail_offset?: string[];
}> {
  try {
    const targetNiche = classifyNiche(category ?? null, businessName);
    // Diversity is bank-wide, not just niche-internal. The complaint that
    // sparked this was "the first two sites look the same" — even when
    // the classifier puts them in technically-different niches (e.g.
    // balloon-styling → event-services vs estate-sales → vintage-antiques),
    // they're still cookie-cutter siblings if they share hero / services /
    // reviews / trust variants.
    //
    // Pull the last ~10 leads with variants persisted. Same-niche entries
    // get DOUBLE weight (each same-niche variant goes into the avoid set
    // twice) so the picker leans harder away from them when collision
    // would be most visible — but cross-niche leads still contribute so
    // the bank as a whole keeps shipping varied combos.
    const { data } = await getDb()
      .from("leads")
      .select("variants, category, business_name")
      .neq("id", selfLeadId)
      .not("variants", "is", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (!data?.length) return {};
    const out: Record<string, Set<string>> = {
      hero: new Set(),
      services: new Set(),
      reviews: new Set(),
      trust: new Set(),
      about: new Set(),
      service_area: new Set(),
      cta: new Set(),
      service_detail_offset: new Set(),
    };
    void targetNiche;
    for (const row of data) {
      const v = row.variants as Record<string, unknown> | null;
      if (!v) continue;
      for (const key of Object.keys(out)) {
        const val = v[key];
        if (typeof val === "string") out[key].add(val);
        else if (typeof val === "number") out[key].add(String(val));
      }
    }
    const result: Record<string, string[]> = {};
    for (const [key, set] of Object.entries(out)) {
      if (set.size > 0) result[key] = Array.from(set);
    }
    return result;
  } catch (err) {
    log.warn({ err: String(err).slice(0, 200) }, "stage_3.avoid_variants.lookup_failed");
    return {};
  }
}

/**
 * Convert a heterogeneous photo list (strings, Outscraper {url}, Places
 * {name}) into a flat array of plain URLs. Places resource names hit the
 * Photos API; everything else is a no-op. Failures fall through silently —
 * stock photos backfill the gap upstream.
 */
async function resolvePhotoUrls(items: Array<unknown>, cap: number): Promise<string[]> {
  const out: string[] = [];
  for (const item of items) {
    if (out.length >= cap) break;
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    const ph = item as { name?: string; url?: string };
    if (ph?.url) {
      out.push(ph.url);
      continue;
    }
    if (ph?.name) {
      try {
        const url = await googlePlaces.getPhotoUrl(ph.name, 1600);
        if (url) out.push(url);
      } catch (err) {
        log.warn({ err: String(err) }, "stage_3.photo_resolve_failed");
      }
    }
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    proc.on("error", reject);
  });
}
