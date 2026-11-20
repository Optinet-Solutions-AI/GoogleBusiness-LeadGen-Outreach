/**
 * api/leads/[id]/contact-form/route.ts — the "Contact form" window: see their form, then send it through AI.
 *
 * Inputs:  GET  params.id
 *          POST params.id + { action: "look", force? } | { action: "send", runId, senderEmail?, subject, message, offerKey? }
 * Outputs: GET  { run: latest attempt with its effective status + a plain sentence | null, estimateUsd }
 *          POST { run, started: boolean } — starts the Cloud Run job (MODE=contact-form STEP=look|send) unless a
 *               recent look was reused; 409 with the plain reason when refused, 503 when Cloud Run isn't set up
 * Used by: components/outreach/ContactFormModal.tsx
 *
 * Thin: zod → lib/contact-form/runs.ts. The look is free; the send is paid (OpenAI computer-use, cost shown first).
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import { contactFormBody } from "@/lib/contact-form/request";
import { START_TEXT, latestRun, markStartFailed, startLook, startSend } from "@/lib/contact-form/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("api.leads.contact-form");
const estimateUsd = () => {
  const n = Number(process.env.OPENAI_FORM_USD_ESTIMATE);
  return Number.isFinite(n) && n > 0 ? n : 0.1;
};

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const run = await latestRun(params.id);
  if (run === "no_table") return fail(START_TEXT.no_table, 409);
  return ok({ run, estimateUsd: estimateUsd() });
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const parsed = contactFormBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  if (!isCloudRunConfigured()) return fail("Contact forms need the Cloud Run worker (not available locally).", 503);

  const body = parsed.data;
  const started = body.action === "look" ? await startLook(params.id, { force: body.force }) : await startSend(params.id, body);
  if (!started.ok) return fail(started.message, 409);
  if ("reused" in started && started.reused) return ok({ run: started.run, started: false });

  const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
  try {
    await triggerJob(
      { MODE: "contact-form", STEP: body.action, LEAD_ID: params.id, RUN_ID: started.run.id },
      { oidcToken, timeoutSeconds: 600 },
    );
  } catch (err) {
    log.error({ lead_id: params.id, run_id: started.run.id, err: String(err) }, "contact_form.trigger_failed");
    await markStartFailed(started.run.id, body.action);
    return fail("Couldn't start the worker. Try again.", 502);
  }
  return ok({ run: started.run, started: true }, { status: 202 });
});
