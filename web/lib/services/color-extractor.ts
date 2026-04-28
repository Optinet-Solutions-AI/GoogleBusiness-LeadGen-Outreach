/**
 * color-extractor.ts — Extract a brand color from a business photo.
 *
 * Inputs:  image URL
 * Outputs: hex color string (e.g. '#1F4E79') for `lead.brand_color`
 * Used by: lib/pipeline/stage-2-enrich.ts
 *
 * Uses node-vibrant (https://github.com/Vibrant-Colors/node-vibrant).
 * Falls back to a neutral hex when extraction fails.
 */

import { getLogger } from "../logger";

const log = getLogger("color-extractor");
export const FALLBACK_HEX = "#1F4E79";

export async function extractBrandColor(source: string): Promise<string> {
  try {
    // Dynamic import: node-vibrant/node spawns worker_threads that Next.js
    // can't bundle at build time. Loading lazily means Node resolves the
    // package from node_modules at request time instead.
    const { Vibrant } = await import("node-vibrant/node");
    const palette = await Vibrant.from(source).getPalette();
    const swatch =
      palette.Vibrant ??
      palette.DarkVibrant ??
      palette.Muted ??
      palette.DarkMuted ??
      palette.LightVibrant;
    if (!swatch) {
      log.warn({ source: source.slice(0, 80) }, "color.no_swatch");
      return FALLBACK_HEX;
    }
    const hex = swatch.hex.toUpperCase();
    log.info({ source: source.slice(0, 80), hex }, "color.extracted");
    return hex;
  } catch (err) {
    log.warn({ err: String(err), source: source.slice(0, 80) }, "color.fallback");
    return FALLBACK_HEX;
  }
}
