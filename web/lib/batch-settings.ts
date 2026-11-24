/**
 * batch-settings.ts — zod schema + defaults for per-batch source settings (batches.settings).
 *
 * Inputs:  raw settings object from the API / CLI (may be empty)
 * Outputs: BatchSettings with defaults applied (WARN: window_days, min_employees; exhibitors: event_urls, year;
 *          review sites: min_rating, max_rating, min_reviews;
 *          Google Maps "Any" niche: niches)
 * Used by: app/api/batches/route.ts, lib/pipeline/orchestrator.ts (createBatch)
 */

import { z } from "zod";

export const BatchSettingsSchema = z.object({
  /** WARN: only notices filed within the last N days. */
  window_days: z.number().int().min(1).max(365).default(90),
  /** WARN: ignore notices affecting fewer than N employees. */
  min_employees: z.number().int().min(0).max(100000).default(10),
  /** Exhibitors: conference pages pasted by the operator (empty = OpenAI finds the shows). */
  event_urls: z.array(z.string().url()).max(25).default([]),
  /** Exhibitors: the year the shows take place. */
  year: z.number().int().min(2020).max(2035).default(2026),
  /**
   * Google Maps "Any" niche (New batch form, 16 Nov 2026): search every niche in the chosen category in one batch,
   * sharing the lead limit. Empty = the batch's single `niche`.
   */
  niches: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  /** Review sites (Trustpilot / TripAdvisor): keep businesses rated from min_rating to max_rating stars (inclusive)… */
  min_rating: z.number().min(1).max(5).default(1),
  max_rating: z.number().min(1).max(5).default(3.5),
  /** …with at least this many reviews (a rating on 2 reviews says little). */
  min_reviews: z.number().int().min(0).max(100000).default(5),
  /** "Run AI Lookup on every lead" (New batch form, 20 Nov 2026): on by default; false = skip the paid web search. */
  ai_lookup: z.boolean().default(true),
  /**
   * "Email this batch automatically" (24 Nov 2026, workflow run_automation.md): its batch email starts by itself 24 h
   * after the batch finishes, with the batch email defaults (cancellable on the batch page). Off unless chosen.
   */
  auto_email: z.boolean().default(false),
}).refine((s) => s.max_rating >= s.min_rating, { message: "max_rating must be at least min_rating", path: ["max_rating"] });

export type BatchSettings = z.infer<typeof BatchSettingsSchema>;

/** How many leads of this batch get AI Lookup: the global per-batch cap, or 0 when the operator unticked it. Pure. */
export function batchAiCap(envCap: number, settings: unknown): number {
  const off = !!settings && typeof settings === "object" && (settings as { ai_lookup?: unknown }).ai_lookup === false;
  return off ? 0 : envCap;
}
