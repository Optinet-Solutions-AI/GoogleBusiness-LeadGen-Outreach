/**
 * api/brain/jobs/[id]/route.ts — one Brain job: read it, answer what it asked, or start it.
 *
 * Inputs:  GET   params.id
 *          PATCH params.id + { action: "refine", missing? | batchId? } (the missing answer / the batch picked)
 *                          | { action: "start", settings } (budget, channels, per-day numbers, follow-ups, EU/UK)
 * Outputs: GET   { job, questions?, estimate?, candidates?, rows } (rows = the plan, once judged)
 *          PATCH refine → { job, questions?, estimate?, candidates? } · start → { job } (the search or the planning has
 *                started on Cloud Run); 409 + plain reason when refused, 503 when migration 074 / OpenAI is missing
 * Used by: components/brain/JobView.tsx (polls GET while the job is searching / planning / running)
 *
 * Thin: zod → lib/brain/jobs.ts. Start is the only paid step here (the search), and only after the budget check.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { isCloudRunConfigured } from "@/lib/services/cloud-run";
import { BrainError } from "@/lib/services/openai-brain";
import { MISSING_074, getJob, jobAsk, refineJob, startJob } from "@/lib/brain/jobs";
import { loadPlan } from "@/lib/brain/plan";
import { patchBody } from "@/lib/brain/request";

export const maxDuration = 60;

const missing074 = (err: unknown) => err instanceof Error && err.message === MISSING_074;

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  try {
    const job = await getJob(params.id);
    if (!job) return fail("Job not found", 404);
    const rows = job.status === "asking" || job.status === "searching" ? [] : await loadPlan(job.id);
    return ok({ ...(await jobAsk(job)), rows });
  } catch (err) {
    if (missing074(err)) return fail(MISSING_074, 503);
    throw err;
  }
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = patchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const body = parsed.data;
  try {
    if (body.action === "refine") {
      const r = await refineJob(params.id, body);
      if (!r.ok) return fail(r.message, 409);
      const { ok: _ok, ...data } = r;
      void _ok;
      return ok(data);
    }
    if (!isCloudRunConfigured()) return fail("The Brain needs the Cloud Run worker (not available locally).", 503);
    const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    const s = await startJob(params.id, { settings: body.settings, oidcToken });
    return s.ok ? ok({ job: s.job }, { status: 202 }) : fail(s.message, 409);
  } catch (err) {
    if (missing074(err)) return fail(MISSING_074, 503);
    if (err instanceof BrainError) return fail("I couldn't read that just now (OpenAI). Try again in a moment.", 503);
    throw err;
  }
});
