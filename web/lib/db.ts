/**
 * db.ts — Supabase client (server-side, service role).
 *
 * Inputs:  env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY
 * Outputs: `db` Supabase client (server-only) — NEVER import in `app/components/`
 * Used by: app/api/* Route Handlers, lib/pipeline/*, scripts/*
 *
 * Security: this uses the SERVICE role key. Server-only. Browser bundles must
 * not see it. Tagged with `import "server-only"` to enforce that.
 */

import "@/lib/server-guard";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config";

let _db: SupabaseClient | null = null;

// Next.js (App Router) caches every fetch() call indefinitely by default,
// even when the route exports `dynamic = "force-dynamic"`. Supabase-js
// issues its REST calls via fetch under the hood, so without this wrapper
// the dashboard would render stale data after the first request — this is
// the root cause of "I deleted the row in Supabase but the dashboard
// still shows it." Forcing cache: 'no-store' makes every Supabase call
// bypass the Next/Vercel fetch cache and hit Postgres for real.
const noCacheFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

export function getDb(): SupabaseClient {
  if (_db) return _db;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY missing — fill in .env at repo root",
    );
  }
  _db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    global: { fetch: noCacheFetch },
  });
  return _db;
}

export type Db = ReturnType<typeof getDb>;
