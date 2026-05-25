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
