/**
 * api/debug-vercel-oidc/route.ts — TEMPORARY diagnostic endpoint.
 *
 * Reports whether Vercel is injecting an OIDC token (via header OR env)
 * and what platform env vars are present. Returns booleans and lengths
 * only — never the token value itself, so this is safe to leave running
 * briefly while debugging.
 *
 * DELETE THIS FILE after the OIDC issue is resolved.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const headerToken = req.headers.get("x-vercel-oidc-token");
  const envToken = process.env.VERCEL_OIDC_TOKEN;

  // Names only of all VERCEL_* env vars present (no values)
  const vercelEnvVarNames = Object.keys(process.env)
    .filter((k) => k.startsWith("VERCEL_"))
    .sort();

  return NextResponse.json({
    success: true,
    data: {
      runtime_env: process.env.VERCEL_ENV ?? null,            // 'production' | 'preview' | 'development'
      vercel_url: process.env.VERCEL_URL ?? null,
      vercel_region: process.env.VERCEL_REGION ?? null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,

      header_token_present: Boolean(headerToken),
      header_token_length: headerToken?.length ?? 0,

      env_token_present: Boolean(envToken),
      env_token_length: envToken?.length ?? 0,

      vercel_env_var_names: vercelEnvVarNames,

      // Useful header subset (just names of x-vercel-* headers)
      x_vercel_header_names: [...req.headers.keys()]
        .filter((h) => h.toLowerCase().startsWith("x-vercel-"))
        .sort(),
    },
  });
}
