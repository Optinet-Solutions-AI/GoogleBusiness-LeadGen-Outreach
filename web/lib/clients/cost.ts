/**
 * cost.ts — Gemini token usage and its estimated USD cost.
 *
 * Inputs:  Usage (prompt/completion token counts + model)
 * Outputs: estimated cost in USD
 * Used by: lib/services/gemini-brand.ts callers, Brand Brain extraction jobs (cost logging)
 */

export type Usage = { prompt_tokens: number; completion_tokens: number; model: string };

/** List price per million tokens for Gemini Flash — update when it changes. */
export const GEMINI_FLASH_USD_PER_M = { input: 0.3, output: 2.5 };

/** Cost of n generated images at the configured per-image price. */
export function imageCostUsd(n: number, imageUsd: number): number {
  return Math.round(n * imageUsd * 1e6) / 1e6;
}

export function estimateCostUsd(usage: Usage): number {
  const usd =
    (usage.prompt_tokens / 1e6) * GEMINI_FLASH_USD_PER_M.input +
    (usage.completion_tokens / 1e6) * GEMINI_FLASH_USD_PER_M.output;
  return Math.round(usd * 1e6) / 1e6;
}
