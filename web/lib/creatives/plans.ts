/**
 * plans.ts — month content plans: create with a cost estimate, read, edit concepts, status, delete.
 *
 * Inputs:  clientId, plan inputs ("YYYY-MM" month, platforms, cadence), concepts
 * Outputs: content_plans rows (+ creative summary counts on getPlan)
 * Used by: /api/clients/[id]/plans*, creative generation job
 */
import "@/lib/server-guard";
import { z } from "zod";
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/clients/profile";
import { estimatePlanUsd } from "./cost";
import { planEstimateCount } from "./state";
import { ConceptSchema, type Concept, type PlanStatus, type Platform } from "./types";

export class PlanStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanStateError";
  }
}

export type PlanRow = {
  id: string;
  client_id: string;
  month: string;
  platforms: Platform[];
  posts_per_week: number;
  product_ids: string[];
  ai_backgrounds: boolean;
  status: PlanStatus;
  concepts: Concept[];
  estimate_usd: number | null;
  generating_started_at: string | null;
  heartbeat_at: string | null;
  pending_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanSummary = { total: number; ready: number; failed: number; approved: number; pending: number };

export type CreatePlanInput = {
  month: string;
  platforms: Platform[];
  posts_per_week: number;
  product_ids?: string[];
  ai_backgrounds: boolean;
};

const GENERATING_MAX_MS = 35 * 60_000;
const HEARTBEAT_MAX_MS = 15 * 60_000;

export function isPlanGenerating(
  row: Pick<PlanRow, "generating_started_at" | "heartbeat_at">,
  now: number = Date.now(),
): boolean {
  if (!row.generating_started_at) return false;
  if (now - Date.parse(row.generating_started_at) >= GENERATING_MAX_MS) return false;
  return !row.heartbeat_at || now - Date.parse(row.heartbeat_at) < HEARTBEAT_MAX_MS;
}

export async function createPlan(clientId: string, input: CreatePlanInput): Promise<PlanRow> {
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .parse(input.month);
  const count = planEstimateCount(month, input.posts_per_week, env.CREATIVE_MAX_PER_PLAN);
  const estimate = estimatePlanUsd(count, input.ai_backgrounds ? count : 0, env.OPENAI_IMAGE_USD_PER_IMAGE);
  const { data, error } = await getDb()
    .from("content_plans")
    .insert({
      client_id: clientId,
      month: `${month}-01`,
      platforms: input.platforms,
      posts_per_week: input.posts_per_week,
      product_ids: input.product_ids ?? [],
      ai_backgrounds: input.ai_backgrounds,
      estimate_usd: estimate,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new PlanStateError("a plan already exists for this month");
    throw new Error(`create plan failed: ${error.message}`);
  }
  return data as PlanRow;
}

async function readPlan(clientId: string, planId: string): Promise<PlanRow> {
  const { data, error } = await getDb()
    .from("content_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(`read plan failed: ${error.message}`);
  if (!data) throw new NotFoundError("plan not found");
  return data as PlanRow;
}

async function approvedCreativeIds(clientId: string, creativeIds: string[]): Promise<Set<string>> {
  if (!creativeIds.length) return new Set();
  const { data, error } = await getDb()
    .from("creative_versions")
    .select("creative_id")
    .eq("client_id", clientId)
    .eq("state", "approved")
    .in("creative_id", creativeIds);
  if (error) throw new Error(`read approved versions failed: ${error.message}`);
  return new Set(((data ?? []) as { creative_id: string }[]).map((r) => r.creative_id));
}

export async function getPlan(clientId: string, planId: string): Promise<PlanRow & { creatives: PlanSummary }> {
  const plan = await readPlan(clientId, planId);
  const { data: cs, error } = await getDb()
    .from("creatives")
    .select("id,status")
    .eq("client_id", clientId)
    .eq("plan_id", planId);
  if (error) throw new Error(`read plan creatives failed: ${error.message}`);
  const rows = (cs ?? []) as { id: string; status: string }[];
  const approved = await approvedCreativeIds(
    clientId,
    rows.map((r) => r.id),
  );
  return {
    ...plan,
    creatives: {
      total: rows.length,
      ready: rows.filter((r) => r.status === "ready").length,
      failed: rows.filter((r) => r.status === "failed").length,
      approved: approved.size,
      pending: rows.filter((r) => r.status === "draft" || r.status === "rendering").length,
    },
  };
}

export async function listPlans(clientId: string): Promise<PlanRow[]> {
  const { data, error } = await getDb()
    .from("content_plans")
    .select("*")
    .eq("client_id", clientId)
    .order("month", { ascending: false });
  if (error) throw new Error(`list plans failed: ${error.message}`);
  return (data ?? []) as PlanRow[];
}

export async function updatePlanConcepts(clientId: string, planId: string, concepts: Concept[]): Promise<PlanRow> {
  const parsed = z.array(ConceptSchema).parse(concepts);
  const plan = await readPlan(clientId, planId);
  if (plan.status !== "planning" && plan.status !== "ready") {
    throw new PlanStateError(`concepts can only be edited while planning or ready (plan is ${plan.status})`);
  }
  const { data, error } = await getDb()
    .from("content_plans")
    .update({ concepts: parsed })
    .eq("client_id", clientId)
    .eq("id", planId)
    .in("status", ["planning", "ready"])
    .select("*");
  if (error) throw new Error(`update concepts failed: ${error.message}`);
  if (!data || data.length === 0) throw new PlanStateError("plan changed state; reload and try again");
  return data[0] as PlanRow;
}

export type PlanCadencePatch = Partial<Pick<PlanRow, "posts_per_week" | "platforms" | "product_ids" | "ai_backgrounds">>;

/** Edit cadence fields (planning/ready only) and refresh the estimate the same way createPlan computes it. */
export async function updatePlanCadence(clientId: string, planId: string, patch: PlanCadencePatch): Promise<PlanRow> {
  const plan = await readPlan(clientId, planId);
  if (plan.status !== "planning" && plan.status !== "ready") {
    throw new PlanStateError(`a plan can only be edited while planning or ready (plan is ${plan.status})`);
  }
  const merged = { ...plan, ...patch };
  const count = planEstimateCount(merged.month.slice(0, 7), merged.posts_per_week, env.CREATIVE_MAX_PER_PLAN);
  const estimate = estimatePlanUsd(count, merged.ai_backgrounds ? count : 0, env.OPENAI_IMAGE_USD_PER_IMAGE);
  const { data, error } = await getDb()
    .from("content_plans")
    .update({ ...patch, estimate_usd: estimate })
    .eq("client_id", clientId)
    .eq("id", planId)
    .in("status", ["planning", "ready"])
    .select("*");
  if (error) throw new Error(`update plan failed: ${error.message}`);
  if (!data || data.length === 0) throw new PlanStateError("plan changed state; reload and try again");
  return data[0] as PlanRow;
}

export async function deletePlan(clientId: string, planId: string): Promise<void> {
  const plan = await readPlan(clientId, planId);
  if (plan.status !== "planning" && plan.status !== "ready") {
    throw new PlanStateError(`a ${plan.status} plan cannot be deleted`);
  }
  const db = getDb();
  const { data: cs, error } = await db.from("creatives").select("id").eq("client_id", clientId).eq("plan_id", planId);
  if (error) throw new Error(`read plan creatives failed: ${error.message}`);
  const approved = await approvedCreativeIds(
    clientId,
    ((cs ?? []) as { id: string }[]).map((r) => r.id),
  );
  if (approved.size) throw new PlanStateError("plan has approved creatives and cannot be deleted");
  const { error: dErr } = await db.from("content_plans").delete().eq("client_id", clientId).eq("id", planId);
  if (dErr) throw new Error(`delete plan failed: ${dErr.message}`);
}

export type PlanPatch = Partial<
  Pick<PlanRow, "generating_started_at" | "heartbeat_at" | "pending_count" | "last_error" | "estimate_usd">
>;

export async function setPlanStatus(
  clientId: string,
  planId: string,
  status: PlanStatus,
  patch: PlanPatch = {},
): Promise<void> {
  const { data, error } = await getDb()
    .from("content_plans")
    .update({ status, ...patch })
    .eq("client_id", clientId)
    .eq("id", planId)
    .select("id");
  if (error) throw new Error(`set plan status failed: ${error.message}`);
  if (!data || data.length === 0) throw new NotFoundError("plan not found");
}

/**
 * Atomically mark the plan `generating` with a fresh generating_started_at + heartbeat. Succeeds when the plan
 * is not generating (same rule as isPlanGenerating), or when `claimedAt` equals the generating_started_at a
 * route already claimed for this job. False = refused (another run is live, or the plan is `done`).
 */
export async function claimGenerating(
  clientId: string,
  planId: string,
  opts: { claimedAt?: string | null; now?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const stamp = new Date(now).toISOString();
  let q = getDb()
    .from("content_plans")
    .update({ status: "generating", generating_started_at: opts.claimedAt ?? stamp, heartbeat_at: stamp, last_error: null })
    .eq("client_id", clientId)
    .eq("id", planId)
    .in("status", ["planning", "ready", "generating"]);
  if (opts.claimedAt) q = q.eq("generating_started_at", opts.claimedAt);
  else {
    const started = new Date(now - GENERATING_MAX_MS).toISOString();
    const beat = new Date(now - HEARTBEAT_MAX_MS).toISOString();
    q = q.or(`generating_started_at.is.null,generating_started_at.lt."${started}",heartbeat_at.lt."${beat}"`);
  }
  const { data, error } = await q.select("id");
  if (error) throw new Error(`claim plan failed: ${error.message}`);
  return !!data && data.length > 0;
}

export async function touchHeartbeat(clientId: string, planId: string): Promise<void> {
  const { error } = await getDb()
    .from("content_plans")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("id", planId);
  if (error) throw new Error(`heartbeat failed: ${error.message}`);
}
