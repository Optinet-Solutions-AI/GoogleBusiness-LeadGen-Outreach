/**
 * limits.ts — per-platform caption length and hashtag limits, and a copy checker.
 *
 * Inputs:  CreativeCopy
 * Outputs: list of limit violations
 * Used by: copy generation / grounding checks, approve gate
 */
import { PLATFORMS, type CreativeCopy, type Platform } from "./types";

export const PLATFORM_LIMITS: Record<Platform, { maxChars: number; maxHashtags: number }> = {
  instagram: { maxChars: 2200, maxHashtags: 20 },
  facebook: { maxChars: 2000, maxHashtags: 5 },
  linkedin: { maxChars: 3000, maxHashtags: 3 },
};

export function checkCaptionLimits(copy: CreativeCopy): { platform: Platform; reason: string }[] {
  const out: { platform: Platform; reason: string }[] = [];
  for (const p of PLATFORMS) {
    const c = copy[p];
    if (!c) continue;
    const lim = PLATFORM_LIMITS[p];
    if (c.caption.length > lim.maxChars) out.push({ platform: p, reason: `caption is ${c.caption.length} chars (max ${lim.maxChars})` });
    if (c.hashtags.length > lim.maxHashtags) out.push({ platform: p, reason: `${c.hashtags.length} hashtags (max ${lim.maxHashtags})` });
  }
  return out;
}
