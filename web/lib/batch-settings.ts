/**
 * batch-settings.ts — zod schema + defaults for per-batch source settings (batches.settings).
 *
 * Inputs:  raw settings object from the API / CLI (may be empty)
 * Outputs: BatchSettings with defaults applied (WARN: window_days, min_employees)
 * Used by: app/api/batches/route.ts, lib/pipeline/orchestrator.ts (createBatch)
 */

import { z } from "zod";

export const BatchSettingsSchema = z.object({
  /** WARN: only notices filed within the last N days. */
  window_days: z.number().int().min(1).max(365).default(90),
  /** WARN: ignore notices affecting fewer than N employees. */
  min_employees: z.number().int().min(0).max(100000).default(10),
});

export type BatchSettings = z.infer<typeof BatchSettingsSchema>;
