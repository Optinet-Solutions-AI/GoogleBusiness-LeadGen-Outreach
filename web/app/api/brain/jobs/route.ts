/**
 * api/brain/jobs/route.ts — the Brain: list the jobs, or give it a new one in plain words.
 *
 * Inputs:  GET  —
 *          POST { command } (3–500 characters) as JSON, or multipart/form-data: command + up to 5 files (≤ 4 MB in
 *          total): one list (.csv / .xlsx) and / or briefs (.pdf / .docx / .txt / .md / images), 27 Nov 2026
 * Outputs: GET  { jobs, missing } (missing = migration 074 not applied)
 *          POST { kind: "reply", text } (something it can't do: nothing happens) or
 *               { kind: "job", job, questions?, estimate?, candidates? } (a job in "asking"; nothing is searched or sent)
 *          503 + plain reason when the OpenAI key or migration 074 is missing
 * Used by: components/brain/BrainClient.tsx
 *
 * Thin: zod / checkFiles → lib/brain/read-files.ts → lib/brain/jobs.ts. One small OpenAI call (under 1 cent) reads
 * the command; a PDF / image brief is read once by OpenAI (~1¢). 400 + plain reason for files it can't take, 503 when
 * migration 081 is missing and files were attached.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { BrainError } from "@/lib/services/openai-brain";
import { MISSING_074, MISSING_081, createJob, listJobs, type JobFiles } from "@/lib/brain/jobs";
import { createBody } from "@/lib/brain/request";
import { checkFiles } from "@/lib/brain/attachments";
import { readUploads } from "@/lib/brain/read-files";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The command and the files of a multipart message (JSON keeps working, without files). */
async function readMessage(req: Request): Promise<{ command: unknown; files: File[] }> {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    return { command: form.get("command"), files };
  }
  const body = (await req.json().catch(() => null)) as { command?: unknown } | null;
  return { command: body?.command, files: [] };
}

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok(await listJobs());
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const msg = await readMessage(req).catch(() => null);
  if (!msg) return fail("Couldn't read the message. Try again.", 400);
  // With files, a short or empty message is fine: the files say what to do.
  const typed = typeof msg.command === "string" ? msg.command.trim() : "";
  const command = msg.files.length && typed.length < 3 ? "Work the attached list (or use the attached brief)." : typed;
  const parsed = createBody.safeParse({ command });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);

  let files: JobFiles | undefined;
  if (msg.files.length) {
    const check = checkFiles(msg.files.map((f) => ({ name: f.name, size: f.size })));
    if (!check.ok) return fail(check.message, 400);
    const uploads = await Promise.all(msg.files.map(async (f) => ({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) })));
    const read = await readUploads(uploads);
    if ("refused" in read) return fail(read.refused, 400);
    files = read;
  }
  try {
    return ok(await createJob(parsed.data.command, undefined, files));
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
    // Files attached but migration 081 (brief / attachments / import_rows) not applied.
    if (files && err instanceof Error && /import_rows|attachments|brief/.test(err.message)) return fail(MISSING_081, 503);
    throw err;
  }
});
