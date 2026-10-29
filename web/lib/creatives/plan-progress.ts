/**
 * plan-progress.ts — a plan's creative progress and what finishing it would still cost.
 *
 * Inputs:  clientId, plan row
 * Outputs: { creatives (with latest version), progress, remaining_estimate_usd }
 * Used by: GET /api/clients/:id/plans[/:pid], POST .../plans/:pid/generate
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { listAssets } from "@/lib/clients/assets";
import { isOpenAiConfigured } from "@/lib/services/openai-images";
import { listCreatives, type CreativeListRow } from "./creatives";
import { latestInputs, planCreatives } from "./generate";
import type { PlanRow } from "./plans";
import { conceptsToGenerate, creativeForConcept, creativeUnitFor } from "./select";

export type PlanProgress = { total: number; ready: number; failed: number; pending: number; rendering: number };

/** Same costing rule as planGenerate: pending concepts, a resumed creative costed from its own inputs. */
export async function remainingEstimateUsd(clientId: string, plan: PlanRow): Promise<number> {
  const existing = await planCreatives(clientId, plan.id);
  const todo = conceptsToGenerate(plan, existing, new Date());
  if (!todo.length) return 0;
  const openai = isOpenAiConfigured();
  const priors = todo.map((i) => creativeForConcept(existing, i)).filter((c) => !!c);
  const inputs = await latestInputs(clientId, priors as typeof existing);
  const assetIds = new Set((await listAssets(clientId, { includeRenders: true })).map((a) => a.id));
  let sum = 0;
  for (const idx of todo) {
    const prior = creativeForConcept(existing, idx);
    sum += creativeUnitFor(
      prior
        ? { templateKey: prior.template_key, inputs: inputs.get(prior.id) ?? {}, plan, assetIds }
        : { templateKey: plan.concepts[idx].template_key, inputs: {}, plan, assetIds },
      openai,
      env.OPENAI_IMAGE_USD_PER_IMAGE,
    );
  }
  return Math.round(sum * 1e6) / 1e6;
}

export async function planDetail(clientId: string, plan: PlanRow) {
  const all = await listCreatives(clientId, {});
  const creatives: CreativeListRow[] = all.filter((c) => c.plan_id === plan.id);
  const progress: PlanProgress = {
    total: creatives.length,
    ready: creatives.filter((c) => c.status === "ready").length,
    failed: creatives.filter((c) => c.status === "failed").length,
    pending: creatives.filter((c) => c.status === "draft").length,
    rendering: creatives.filter((c) => c.status === "rendering").length,
  };
  return { plan, creatives, progress, remaining_estimate_usd: await remainingEstimateUsd(clientId, plan) };
}
