/**
 * services/cloud-run.ts — Triggers a Cloud Run Job execution from Vercel,
 * authenticated via Workload Identity Federation (no long-lived keys).
 *
 * Inputs:  batchId
 * Outputs: starts an async Cloud Run Job execution with BATCH_ID set as a
 *          container env override. Returns { configured: false } via
 *          isCloudRunConfigured() if the GCP env vars are missing —
 *          the route handler falls back to inline `waitUntil` in that case.
 * Used by: app/api/batches/[id]/run/route.ts
 *
 * Auth flow (Workload Identity Federation):
 *   1. Vercel injects VERCEL_OIDC_TOKEN into every function invocation
 *      (when OIDC Federation is enabled in Vercel project settings).
 *   2. We hand that JWT to GCP's STS, which validates it against the
 *      Workload Identity Pool we've configured.
 *   3. STS returns a short-lived federated token; we then call
 *      iamcredentials.generateAccessToken to impersonate vercel-trigger-sa.
 *   4. The resulting bearer token has roles/run.invoker on the job and
 *      lives ~1 hour.
 *
 * Why a separate module: the route handler should stay thin. Auth + REST
 * shape lives here.
 */

import "@/lib/server-guard";
import { ExternalAccountClient } from "google-auth-library";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";

const log = getLogger("cloud-run");

export function isCloudRunConfigured(): boolean {
  return Boolean(
    env.GCP_PROJECT_ID &&
      env.GCP_REGION &&
      env.CLOUD_RUN_JOB_NAME &&
      env.GCP_WORKLOAD_IDENTITY_PROVIDER &&
      env.GCP_SERVICE_ACCOUNT_EMAIL,
  );
}

async function mintGcpAccessToken(oidcToken: string | null): Promise<string> {
  // Vercel injects the OIDC token via the `x-vercel-oidc-token` request
  // header in production (and as a fallback into VERCEL_OIDC_TOKEN env
  // var for dev). The route handler is responsible for pulling from the
  // request and passing it in — by the time we're here it's already
  // resolved.
  if (!oidcToken) {
    throw new Error(
      "Vercel OIDC token missing — enable OIDC Federation in Vercel: " +
        "Project → Settings → Security → OIDC Federation, then redeploy",
    );
  }

  // ExternalAccountClient reads the subject token from a file. Vercel
  // hands us the token as an env var, so we drop it onto /tmp first.
  // /tmp on Vercel is a per-invocation tmpfs that's wiped between
  // requests, so this is safe (the token is short-lived too — ~15 min).
  const tokenPath = join(tmpdir(), "vercel_oidc_token");
  writeFileSync(tokenPath, oidcToken.trim(), { mode: 0o600 });

  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/${env.GCP_WORKLOAD_IDENTITY_PROVIDER}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
      `${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    credential_source: {
      file: tokenPath,
    },
  });

  if (!client) throw new Error("failed to construct WIF client (config malformed)");

  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token;
  if (!token) throw new Error("WIF token exchange returned no access_token");
  return token;
}

/**
 * Run the Cloud Run Job with arbitrary env-var overrides. The same image
 * serves every workload (batch scrape / lead build / improve / regenerate)
 * — the entrypoint dispatches on MODE.
 *
 * The `oidcToken` MUST be supplied by the caller (pulled from the
 * `x-vercel-oidc-token` request header in the route handler). If
 * null/empty, the call throws a descriptive error.
 */
export async function triggerJob(
  envOverrides: Record<string, string>,
  opts: { oidcToken: string | null; timeoutSeconds?: number },
): Promise<{ operationName: string }> {
  const accessToken = await mintGcpAccessToken(opts.oidcToken);

  const url =
    `https://run.googleapis.com/v2/projects/${env.GCP_PROJECT_ID}` +
    `/locations/${env.GCP_REGION}` +
    `/jobs/${env.CLOUD_RUN_JOB_NAME}:run`;

  const body = {
    overrides: {
      containerOverrides: [
        {
          env: Object.entries(envOverrides).map(([name, value]) => ({ name, value })),
        },
      ],
      timeout: `${opts.timeoutSeconds ?? 1800}s`,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    log.error({ env: Object.keys(envOverrides), status: res.status, body: text }, "trigger.failed");
    throw new Error(`Cloud Run trigger failed (${res.status}): ${text}`);
  }
  const op = JSON.parse(text) as { name?: string };
  log.info({ env: Object.keys(envOverrides), operation: op.name }, "trigger.ok");
  return { operationName: op.name ?? "" };
}

/**
 * Convenience wrapper for the original scrape path — preserved so older
 * callers don't need to be rewritten.
 */
export async function triggerBatchJob(
  batchId: string,
  opts: { oidcToken: string | null },
): Promise<{ operationName: string }> {
  return triggerJob({ MODE: "batch", BATCH_ID: batchId }, opts);
}
