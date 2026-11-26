/**
 * api/brain/jobs/[id]/control/route.ts — Pause, Resume, Cancel a Brain job, or raise its budget.
 *
 * Inputs:  POST params.id + { action: "pause" | "resume" | "cancel" } | { action: "raise_budget", budgetUsd }
 * Outputs: { job } with its new status; 409 + plain reason when refused (e.g. "Raise the budget first")
 * Used by: components/brain/JobView.tsx
 *
 * Thin: zod → lib/brain/control.ts.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { controlJob, type ControlAction } from "@/lib/brain/control";
import { controlBody } from "@/lib/brain/request";

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = controlBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const b = parsed.data;
  const action: ControlAction = b.action === "raise_budget" ? { kind: "raise_budget", budgetUsd: b.budgetUsd } : { kind: b.action };
  const r = await controlJob(params.id, action);
  return r.ok ? ok({ job: r.job }) : fail(r.message, 409);
});
