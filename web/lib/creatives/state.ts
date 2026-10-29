/**
 * state.ts — pure rules for creative version states, approval gating and plan sizing.
 *
 * Inputs:  version state / renders / grounding, review actions, month + cadence
 * Outputs: approval verdicts, next states, creative counts
 * Used by: creatives.ts (reviewVersion, newVersion), plans.ts (createPlan)
 */
import { spreadSlots } from "./slots";
import { ASPECTS, type Aspect, type Grounding, type RenderRef, type VersionState } from "./types";

export type ReviewAction = "approve" | "reject" | "request_changes";
export const PLAN_WEEKS = 4;

export function canApprove(
  v: { state?: VersionState; renders: RenderRef[]; grounding: Grounding },
  required: readonly Aspect[] = ASPECTS,
): { ok: boolean; reason?: string } {
  if (!v.grounding || v.grounding.ok !== true) return { ok: false, reason: "grounding check failed" };
  const have = new Set((v.renders ?? []).map((r) => r.aspect));
  const missing = required.filter((a) => !have.has(a));
  if (missing.length) return { ok: false, reason: `missing renders: ${missing.join(", ")}` };
  return { ok: true };
}

export function nextStateForReview(state: VersionState, action: ReviewAction): VersionState | Error {
  if (state !== "draft") return new Error(`only draft versions can be reviewed (is ${state})`);
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  return "changes_requested";
}

export const editCreatesDraft = (state: VersionState): boolean => state !== "draft";

/** How many creatives a plan will have: slots on the cadence, capped. */
export function planEstimateCount(month: string, postsPerWeek: number, max: number): number {
  return Math.min(spreadSlots(month, postsPerWeek, postsPerWeek * PLAN_WEEKS).length, max);
}
