/**
 * cost.ts — pure cost estimation, budget cap and spend roll-up for creative generation.
 *
 * Inputs:  counts and the per-image price (passed in, never read from env here); generation_jobs cost rows
 * Outputs: USD figures (estimates, the run's budget stop, spend per plan / per creative)
 * Used by: plan cost preview, generation budget guard, plan detail (spent so far)
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

/**
 * One Generate run's hard stop (Ruling 32): min(confirmed × 1.25, plan budget − AI spend already recorded for
 * this plan across earlier runs), never below 0.
 */
export function runCapUsd(opts: { confirmedUsd: number; planBudgetUsd: number; spentBeforeUsd: number }): number {
  const left = opts.planBudgetUsd - Math.max(0, opts.spentBeforeUsd);
  return Math.max(0, budgetCapUsd(Math.max(0, opts.confirmedUsd), left));
}

export type SpendRow = { cost_usd: number | string | null; creative_id?: string | null };
export type Spend = { total_usd: number; by_creative: Record<string, number> };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Sum generation_jobs cost rows: the plan total and the part attributable to each creative. */
export function sumSpend(rows: SpendRow[]): Spend {
  let total = 0;
  const by: Record<string, number> = {};
  for (const r of rows) {
    const usd = Number(r.cost_usd ?? 0);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    total += usd;
    if (r.creative_id) by[r.creative_id] = (by[r.creative_id] ?? 0) + usd;
  }
  for (const k of Object.keys(by)) by[k] = round6(by[k]);
  return { total_usd: round6(total), by_creative: by };
}
