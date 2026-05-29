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
import { selectHeroPhoto } from "./gemini";
import { getLogger } from "../logger";

const log = getLogger("photo-selector");
const TOTAL_PHOTOS = 6;
const MIN_VISION_SCORE = 40;
const MAX_STOCK_CANDIDATES = 3;
const MAX_REAL_CANDIDATES = 4;
/**
 * When the lead has at least this many real Google Places photos, we
 * STOP showing stock candidates to Gemini Vision. The model had a
 * strong tendency to pick a polished stock photo over a competent (but
 * less postcard-perfect) real business photo — which hurt authenticity
 * when the prospect saw the demo. Bias the choice toward real photos
 * by removing the temptation from the candidate set entirely; stock
 * still fills the remaining ordered_photos slots after the hero pick.
 *
 * If real-photo count is BELOW this threshold (0-1), stock still
 * competes — at that point the real photo set is too thin to risk
 * landing on the lone candidate if it's actually bad.
 */
const MIN_REAL_FOR_REAL_ONLY = 2;

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
  if (visionResult) {
    // Reached only if vision returned a response but it was either low-score
    // or had a hero URL not in the candidate list (model hallucination).
    log.info(
      { score: visionResult.score },
      visionResult.score < MIN_VISION_SCORE ? "vision.low_score" : "vision.invalid_hero",
    );
  }
  const ordered = noRealPhotosOrder(input.lead.id, input.stockPool);
  return {
    hero: ordered[0] ?? "",
    ordered_photos: ordered,
    vision_score: visionResult?.score ?? 0,
    source: "hash-fallback",
  };
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

  // Branch 2: has real photos — one Gemini Vision call.
  //
  // Two sub-branches:
  //   • >=2 real photos → show ONLY real photos to Vision. Stock pool is
  //     reserved for ordering padding after the hero is locked in. Bias
  //     keeps the hero authentic; a low Vision score still falls through
  //     to hash-fallback (which then uses stock), so a genuinely bad real
  //     photo set isn't forced through.
  //   • 0-1 real photos → mix stock candidates in. The single real photo
  //     might be unusable; we want Vision to be able to choose stock.
  const realCandidates = input.realPhotos.slice(0, MAX_REAL_CANDIDATES);
  const useRealOnly = realCandidates.length >= MIN_REAL_FOR_REAL_ONLY;
  const stockCandidates = useRealOnly ? [] : input.stockPool.slice(0, MAX_STOCK_CANDIDATES);
  const candidates = [...realCandidates, ...stockCandidates];
  log.info(
    { lead_id: input.lead.id, real: realCandidates.length, stock: stockCandidates.length, useRealOnly },
    "vision.candidates",
  );

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

  return decideFromVision(vision, input, candidates);
}
