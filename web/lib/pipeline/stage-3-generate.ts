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
import { getDb } from "../db";
import { getLogger } from "../logger";
import { generateCopy } from "../services/gemini";
import type { SiteCopy } from "../services/gemini";
import { slugify } from "../slugify";

const log = getLogger("stage-3");

const REPO_ROOT = path.resolve(process.cwd(), "..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".tmp", "generated-sites");

export interface Lead {
  id: string;
  business_name: string;
  phone?: string | null;
  address?: string | null;
  brand_color?: string | null;
  photos?: Array<unknown>;
  reviews?: Array<unknown>;
  category?: string | null;
  service_areas?: string[];          // optional, post-improve enrichment
  business_hours?: Record<string, string>;
}

export interface OverrideCopy extends Partial<SiteCopy> {
  // operator can hand-edit any subset of generated copy
}

export async function run(
  lead: Lead,
  templateSlug: string,
  overrides: { copy?: OverrideCopy; photos?: string[] } = {},
): Promise<string> {
  // Resolve the template directory with a fallback to 'trades'. The modal
  // routes some niche categories to slugs we haven't built out yet
  // (food-beverage / beauty-wellness / professional-services). Falling
  // back instead of throwing keeps the build path working for those
  // niches today; we can add real templates later.
  let resolvedSlug = templateSlug;
  let templateDir = path.join(TEMPLATES_DIR, resolvedSlug);
  if (!(await exists(templateDir))) {
    log.warn(
      { lead_id: lead.id, requested: templateSlug, fallback: "trades" },
      "stage_3.template_missing_fallback",
    );
    resolvedSlug = "trades";
    templateDir = path.join(TEMPLATES_DIR, resolvedSlug);
    if (!(await exists(templateDir))) {
      throw new Error(
        `Neither '${templateSlug}' nor fallback 'trades' exists under ${TEMPLATES_DIR}`,
      );
    }
  }
  log.info({ lead_id: lead.id, template: resolvedSlug }, "stage_3.start");

  const generated = await generateCopy({
    business_name: lead.business_name,
    category: lead.category ?? null,
    address: lead.address ?? null,
    reviews: lead.reviews ?? [],
    service_areas_hints: lead.service_areas ?? [],
  });

  // operator-supplied overrides win over Gemini output
  const copy: SiteCopy = { ...generated, ...(overrides.copy ?? {}) } as SiteCopy;

  const photos = overrides.photos ?? (lead.photos ?? []);

  const siteData = {
    business_name: lead.business_name,
    phone: lead.phone ?? null,
    address: lead.address ?? null,
    brand_color: lead.brand_color ?? "#1F4E79",
    photos,
    reviews: (lead.reviews ?? []).slice(0, 6),
    business_hours: lead.business_hours ?? null,
    service_areas: lead.service_areas ?? [],
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
  await runCmd("npm", ["run", "build"], templateDir);

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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    proc.on("error", reject);
  });
}
