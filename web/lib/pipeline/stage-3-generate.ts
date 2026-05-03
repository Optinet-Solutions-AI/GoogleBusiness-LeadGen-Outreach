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
import { pickStockPhotosForNiche } from "../data/stock-photos";
import { getDb } from "../db";
import { getLogger } from "../logger";
import { classifyNiche } from "../niche";
import { derivePalette } from "../palette";
import { pickVariants, pickTheme } from "../picker";
import * as googlePlaces from "../services/google-places";
import { generateSiteData } from "../services/gemini";
import type { AiSiteData, SiteCopy } from "../services/gemini";
import { slugify } from "../slugify";

/** Cap photo URL resolution to bound Places Photos cost (~$0.007/photo). */
const MAX_REAL_PHOTOS = 4;
/** Total photos every site renders with. */
const TOTAL_PHOTOS = 6;
/** Stock photos guaranteed in the first N slots — magazine-quality first
 *  impression even when scraped photos are good. Real Google photos go in
 *  slots [STOCK_HEAD .. TOTAL_PHOTOS). */
const STOCK_HEAD = 2;

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

  const ai: AiSiteData = await generateSiteData({
    business_name: lead.business_name,
    category: lead.category ?? null,
    address: lead.address ?? null,
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    reviews: lead.reviews ?? [],
    business_hours: lead.business_hours ?? null,
    service_areas_hints: lead.service_areas ?? [],
  });

  // Operator-supplied copy overrides win over AI output.
  const copy: SiteCopy = { ...ai.copy, ...(overrides.copy ?? {}) } as SiteCopy;

  // Photo composition: blend niche-specific premium stock with the lead's
  // real Google photos so every site has magazine-quality first impressions
  // PLUS authentic specificity. Slots 0–1 are ALWAYS premium stock from the
  // niche pool (because Google photos are often phone snapshots — fluorescent
  // garages, tilted logos — that ruin the hero). Slots 2–5 prefer real
  // photos, fall back to stock if the lead has fewer than MAX_REAL_PHOTOS.
  const rawPhotos = overrides.photos ?? (lead.photos ?? []);
  const realPhotos = await resolvePhotoUrls(rawPhotos, MAX_REAL_PHOTOS);
  const niche = classifyNiche(lead.category ?? null);
  const stockPool = pickStockPhotosForNiche(niche, TOTAL_PHOTOS);
  const realSlots = TOTAL_PHOTOS - STOCK_HEAD;
  const realFilled = realPhotos.slice(0, realSlots);
  const stockFill = stockPool.slice(STOCK_HEAD, STOCK_HEAD + realSlots - realFilled.length);
  const photos = [
    ...stockPool.slice(0, STOCK_HEAD),  // hero + 2nd-impression slots
    ...realFilled,                       // their real photos
    ...stockFill,                        // stock padding when real is sparse
  ];
  log.info(
    { lead_id: lead.id, niche, real: realFilled.length, stock: TOTAL_PHOTOS - realFilled.length },
    "stage_3.photo_composition",
  );

  // AI returns niche-aware palette + variants. Fall back to deterministic
  // helpers only if the AI response is missing/malformed (defensive — schema
  // marks both required, so this is belt-and-suspenders).
  const palette = ai.palette ?? derivePalette(lead.brand_color);
  const variants =
    ai.variants ??
    pickVariants({
      rating: lead.rating ?? null,
      review_count: lead.review_count ?? null,
      photos,
      trust_strip: copy.trust_strip,
      category: lead.category ?? null,
      niche,
    });

  // Theme — Gemini's pick wins; pickTheme is the niche-aware fallback when
  // the AI response is missing the field (older models / schema drift).
  const theme = ai.theme ?? pickTheme(niche);

  // Merge: DB facts win when present, AI fallbacks fill the gaps.
  const dbReviews = (lead.reviews ?? []) as Array<unknown>;
  const reviews = dbReviews.length > 0 ? dbReviews.slice(0, 6) : (ai.reviews ?? []).slice(0, 6);
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

  const { error } = await getDb()
    .from("leads")
    .update({ stage: "generated" })
    .eq("id", lead.id);
  if (error) throw new Error(`stage_3.persist.error: ${error.message}`);

  log.info({ lead_id: lead.id, dist: distDest }, "stage_3.done");
  return distDest;
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
