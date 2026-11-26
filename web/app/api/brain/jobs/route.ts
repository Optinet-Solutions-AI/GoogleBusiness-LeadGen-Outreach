/**
 * api/brain/jobs/route.ts — the Brain: list the jobs, or give it a new one in plain words.
 *
 * Inputs:  GET  —
 *          POST { command } (3–500 characters)
 * Outputs: GET  { jobs, missing } (missing = migration 074 not applied)
 *          POST { kind: "reply", text } (something it can't do: nothing happens) or
 *               { kind: "job", job, questions?, estimate?, candidates? } (a job in "asking"; nothing is searched or sent)
 *          503 + plain reason when the OpenAI key or migration 074 is missing
 * Used by: components/brain/BrainClient.tsx
 *
 * Thin: zod → lib/brain/jobs.ts. One small OpenAI call (under 1 cent) reads the command.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { BrainError } from "@/lib/services/openai-brain";
import { MISSING_074, createJob, listJobs } from "@/lib/brain/jobs";
import { createBody } from "@/lib/brain/request";

export const maxDuration = 60;

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok(await listJobs());
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = createBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  try {
    return ok(await createJob(parsed.data.command));
  } catch (err) {
    if (err instanceof BrainError) {
      return fail(
        err.code === "not_configured"
          ? "The Brain isn't switched on (the OpenAI key is missing). Ask the admin."
          : err.code === "no_credit"
            ? "The OpenAI account is out of credit, so I can't read the job. Ask the admin."
            : err.code === "key_invalid"
              ? "OpenAI refused our key, so I can't read the job. Ask the admin."
              : "I couldn't read that just now. Try again in a moment.",
        503,
      );
    }
    if (err instanceof Error && err.message === MISSING_074) return fail(MISSING_074, 503);
    throw err;
  }
});
