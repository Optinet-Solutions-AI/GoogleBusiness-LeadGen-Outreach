/**
 * cloudflare-pages.ts — Deploy a built static site to Cloudflare Pages.
 *
 * Inputs:  project slug, dist directory containing built HTML/CSS/JS
 * Outputs: live URL on `<slug>.pages.dev` (or the custom root domain)
 * Used by: lib/pipeline/stage-4-deploy.ts
 *
 * Flow:
 *   1. POST /accounts/.../pages/projects                   idempotent create
 *   2. POST /accounts/.../pages/projects/.../deployments   multipart upload
 *   3. Return deployment.url
 */

import fs from "node:fs/promises";
import path from "node:path";
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
  const url = `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${slug}/deployments`;

  const form = new FormData();
  for (const filePath of await walk(distDir)) {
    const rel = path.relative(distDir, filePath).split(path.sep).join("/");
    const buf = await fs.readFile(filePath);
    form.append("file", new Blob([buf]), rel);
  }

  const resp = await retry(
    () => fetch(url, { method: "POST", headers: authHeaders(), body: form }),
    { maxAttempts: 3 },
  );
  if (!resp.ok) throw new Error(`cf.deploy.error ${resp.status}: ${await resp.text()}`);
  const json = (await resp.json()) as { result?: { url?: string } };
  const liveUrl = json.result?.url ?? `https://${slug}.pages.dev`;
  log.info({ slug, url: liveUrl }, "cf.deploy.ok");
  return liveUrl;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
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
