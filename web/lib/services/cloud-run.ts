/**
 * services/cloud-run.ts — Triggers a Cloud Run Job execution from the
 * Vercel route handler.
 *
 * Inputs:  batchId
 * Outputs: starts an async Cloud Run Job execution with BATCH_ID set as a
 *          container env override, returns the operation name. Returns
 *          { configured: false } if any GCP env var is missing — the
 *          route handler falls back to inline `waitUntil` in that case.
 * Used by: app/api/batches/[id]/run/route.ts
 *
 * Why a separate module: the route handler should stay thin (validate,
 * trigger, return 202). Auth + REST shape lives here.
 */

import "server-only";
import { JWT } from "google-auth-library";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";

const log = getLogger("cloud-run");

export function isCloudRunConfigured(): boolean {
  return Boolean(
    env.GCP_PROJECT_ID &&
      env.GCP_REGION &&
      env.CLOUD_RUN_JOB_NAME &&
      env.GCP_SA_KEY_BASE64,
  );
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function loadServiceAccount(): ServiceAccountKey {
  const decoded = Buffer.from(env.GCP_SA_KEY_BASE64, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as ServiceAccountKey;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GCP_SA_KEY_BASE64 missing client_email or private_key");
  }
  return parsed;
}

/**
 * Run a Cloud Run Job with BATCH_ID set as a container env override.
 * Resolves once the API has accepted the execution — the job itself runs
 * async on Cloud Run's side, writing back to Supabase as it progresses.
 */
export async function triggerBatchJob(batchId: string): Promise<{
  operationName: string;
}> {
  const sa = loadServiceAccount();

  // Mint an OAuth access token via JWT bearer. `roles/run.invoker` on the
  // job is the only IAM grant the SA needs — no broader Cloud Run perms.
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const { access_token } = await client.authorize();
  if (!access_token) throw new Error("failed to mint GCP access token");

  const url =
    `https://run.googleapis.com/v2/projects/${env.GCP_PROJECT_ID}` +
    `/locations/${env.GCP_REGION}` +
    `/jobs/${env.CLOUD_RUN_JOB_NAME}:run`;

  // containerOverrides[0] applies to the first (only) container in the job's
  // task spec. Setting BATCH_ID via override means the same job image serves
  // every batch — we don't need a job-per-batch.
  const body = {
    overrides: {
      containerOverrides: [
        {
          env: [{ name: "BATCH_ID", value: batchId }],
        },
      ],
      // Defensive cap so a runaway job can't burn quota indefinitely. The
      // job itself can be configured with a higher --task-timeout; this is
      // the per-execution cap.
      timeout: "1800s", // 30 min
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    log.error({ batch_id: batchId, status: res.status, body: text }, "trigger.failed");
    throw new Error(`Cloud Run trigger failed (${res.status}): ${text}`);
  }

  // Response shape: { name: "projects/.../operations/<id>", metadata: {...} }
  const op = JSON.parse(text) as { name?: string };
  log.info({ batch_id: batchId, operation: op.name }, "trigger.ok");
  return { operationName: op.name ?? "" };
}
