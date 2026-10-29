/**
 * cost.ts — pure cost estimation and budget cap for creative generation.
 *
 * Inputs:  counts and the per-image price (passed in, never read from env here)
 * Outputs: USD figures
 * Used by: plan cost preview, generation budget guard
 */

const COPY_USD = 0.003;

export function creativeUnitUsd(opts: { background: boolean }, imageUsd: number): number {
  return COPY_USD + (opts.background ? imageUsd : 0);
}

export function estimatePlanUsd(count: number, backgrounds: number, imageUsd: number): number {
  return count * COPY_USD + backgrounds * imageUsd;
}

export function budgetCapUsd(confirmedEstimate: number, planBudget: number): number {
  return Math.min(confirmedEstimate * 1.25, planBudget);
}
