/**
 * state.ts — pure rules for creative version states, approval gating and plan sizing.
 *
 * Inputs:  version state / renders / grounding, review actions, month + cadence, plan / creative run stamps
 * Outputs: approval verdicts, next states, creative counts, live / stalled run verdicts (client-safe)
 * Used by: creatives.ts (reviewVersion, newVersion, claim), plans.ts (createPlan, claim), select.ts, PlanMonthWizard, CreativeView
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

/** A plan claim older than this is abandoned even with a fresh heartbeat (Cloud Run job timeout + margin). */
export const PLAN_GENERATING_MAX_MS = 35 * 60_000;
/** A generating plan whose heartbeat is older than this is treated as a lost run (spec §12.6). */
export const PLAN_HEARTBEAT_MAX_MS = 15 * 60_000;
/** A `rendering` creative untouched for longer than this is treated as abandoned and may be re-claimed. */
export const RENDERING_STALE_MS = 15 * 60_000;

/** True while a live run holds the plan (server claim rule; the UI treats a stale claim as idle). */
export function isPlanGenerating(
  row: { generating_started_at: string | null; heartbeat_at: string | null },
  now: number = Date.now(),
): boolean {
  if (!row.generating_started_at) return false;
  if (now - Date.parse(row.generating_started_at) >= PLAN_GENERATING_MAX_MS) return false;
  return !row.heartbeat_at || now - Date.parse(row.heartbeat_at) < PLAN_HEARTBEAT_MAX_MS;
}

/** A plan left `generating` by a run that died (stale claim): the UI offers Generate again. */
export const isPlanStalled = (
  row: { status: string; generating_started_at: string | null; heartbeat_at: string | null },
  now: number = Date.now(),
): boolean => row.status === "generating" && !isPlanGenerating(row, now);

/** A creative left `rendering` by a run that died (untouched > RENDERING_STALE_MS): the UI unlocks its actions. */
export const isRenderingStale = (c: { status: string; updated_at: string }, now: number = Date.now()): boolean =>
  c.status === "rendering" && now - Date.parse(c.updated_at) > RENDERING_STALE_MS;
