/**
 * safe-db.ts — small helpers that wrap the Supabase client so server
 * components don't 500 when env vars are missing.
 *
 * Used by every (dashboard)/* page so the UI shows a "Connect Supabase"
 * banner + empty states instead of a generic Next.js error page when the
 * project hasn't been wired yet.
 */

import "server-only";
import { env } from "./config";
import { getDb } from "./db";

/** True when SUPABASE_URL + SUPABASE_SERVICE_KEY are both populated. */
export function isDbConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

/**
 * Run an async DB query, returning `fallback` when env is missing OR the
 * query throws. Server components can `await safeDb(...)` and trust the result.
 */
export async function safeDb<T>(fn: (db: ReturnType<typeof getDb>) => Promise<T>, fallback: T): Promise<T> {
  if (!isDbConfigured()) return fallback;
  try {
    return await fn(getDb());
  } catch (err) {
    console.error("[safe-db] query failed:", err);
    return fallback;
  }
}
