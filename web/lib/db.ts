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

import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config";

let _db: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (_db) return _db;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY missing — fill in .env at repo root",
    );
  }
  _db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  return _db;
}

export type Db = ReturnType<typeof getDb>;
