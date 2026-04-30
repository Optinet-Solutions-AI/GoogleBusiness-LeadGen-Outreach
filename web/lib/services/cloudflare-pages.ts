/**
 * cloudflare-pages.ts — Deploy a built static site to Cloudflare Pages.
 *
 * Inputs:  project slug, dist directory containing built HTML/CSS/JS
 * Outputs: live URL on `<slug>.pages.dev` (or the custom root domain)
 * Used by: lib/pipeline/stage-4-deploy.ts
 *
 * Why wrangler: Cloudflare's REST direct-upload API now requires a
 * manifest of <path -> content-hash> entries, a separate
 * /check-missing call, and a third call to upload missing assets.
 * Re-implementing all three in pure fetch worked previously but
 * Cloudflare changed the deployment endpoint to reject requests
 * without a manifest field (HTTP 400, code 8000096). Wrangler is the
 * official CLI and handles all of this. The container has it
 * pre-installed via the Dockerfile.
 */

import { spawn } from "node:child_process";
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("cloudflare-pages");
const API = "https://api.cloudflare.com/client/v4";

function authHeaders(): Record<string, string> {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN missing");
  return { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
}

export async function ensureProject(slug: string): Promise<void> {
  const url = `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`;
  const resp = await retry(
    () =>
      fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: slug, production_branch: "main" }),
      }),
    { maxAttempts: 3 },
  );
  if (resp.status === 200 || resp.status === 409) {
    log.info({ slug, status: resp.status }, "cf.project.ok");
    return;
  }
  throw new Error(`cf.project.error ${resp.status}: ${await resp.text()}`);
}

export async function deploy(slug: string, distDir: string): Promise<string> {
  await ensureProject(slug);

  log.info({ slug, distDir }, "cf.deploy.start");
  const stdout = await runWrangler(["pages", "deploy", distDir, "--project-name", slug]);

  // Wrangler prints the deployment URL on its last meaningful line, e.g.
  //   "Deployment complete! Take a peek over at https://abc123.<slug>.pages.dev"
  // We extract the URL but fall back to the canonical project URL.
  const match = stdout.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\S*/i);
  const liveUrl = match?.[0] ?? `https://${slug}.pages.dev`;
  log.info({ slug, url: liveUrl }, "cf.deploy.ok");
  return liveUrl;
}

/**
 * Run wrangler with our auth env vars, capturing stdout/stderr. Throws if
 * wrangler exits non-zero. The container's Dockerfile installs wrangler
 * globally so it's on PATH.
 */
function runWrangler(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!env.CLOUDFLARE_API_TOKEN) {
      return reject(new Error("CLOUDFLARE_API_TOKEN missing"));
    }
    if (!env.CLOUDFLARE_ACCOUNT_ID) {
      return reject(new Error("CLOUDFLARE_ACCOUNT_ID missing"));
    }
    const proc = spawn("wrangler", args, {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      },
    });
    const out: string[] = [];
    const err: string[] = [];
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      out.push(text);
      log.debug({ wrangler: text.trimEnd() }, "cf.wrangler.stdout");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      err.push(text);
      log.debug({ wrangler: text.trimEnd() }, "cf.wrangler.stderr");
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve(out.join(""));
      } else {
        reject(
          new Error(
            `wrangler ${args.join(" ")} exited ${code}\n` +
              `--- stdout ---\n${out.join("")}\n--- stderr ---\n${err.join("")}`,
          ),
        );
      }
    });
  });
}

/**
 * Attach a custom domain to an existing Pages project.
 * Customer must point a CNAME record `<their-domain> → <slug>.pages.dev`
 * (or A/AAAA records to Cloudflare's IPs) for SSL provisioning to complete.
 *
 * Idempotent — re-calling for the same (slug, domain) returns the existing entry.
 */
export async function attachCustomDomain(slug: string, domain: string): Promise<void> {
  const url =
    `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}` +
    `/pages/projects/${slug}/domains`;

  const resp = await retry(
    () =>
      fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: domain }),
      }),
    { maxAttempts: 3 },
  );

  // 200 = created; 409 / 400 with "already exists" semantics = idempotent OK
  if (resp.status === 200 || resp.status === 409) {
    log.info({ slug, domain, status: resp.status }, "cf.domain.attached");
    return;
  }
  const body = await resp.text();
  if (body.toLowerCase().includes("already exists")) {
    log.info({ slug, domain }, "cf.domain.already_exists");
    return;
  }
  throw new Error(`cf.domain.attach.error ${resp.status}: ${body}`);
}
