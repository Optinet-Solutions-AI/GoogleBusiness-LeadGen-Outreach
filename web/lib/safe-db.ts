/**
 * safe-db.ts — small helpers that wrap the Supabase client so server
 * components don't 500 when env vars are missing.
 *
 * Used by every (dashboard)/* page so the UI shows a "Connect Supabase"
 * banner + empty states instead of a generic Next.js error page when the
 * project hasn't been wired yet.
 */

import "@/lib/server-guard";
import { env } from "./config";
import { getDb } from "./db";

/** True when SUPABASE_URL + SUPABASE_SERVICE_KEY are both populated. */
export function isDbConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

/** Three-way DB health for the dashboard banner. */
export type DbHealth = "unconfigured" | "no_schema" | "ok" | "error";

export async function getDbHealth(): Promise<DbHealth> {
  if (!isDbConfigured()) return "unconfigured";
  try {
    const { error } = await getDb().from("batches").select("id").limit(1);
    if (!error) return "ok";
    if (
      typeof error.message === "string" &&
      (error.message.includes("Could not find the table") ||
        error.message.toLowerCase().includes("schema cache") ||
        error.message.toLowerCase().includes("relation") ||
        error.message.toLowerCase().includes("does not exist"))
    ) {
      return "no_schema";
    }
    return "error";
  } catch {
    return "error";
  }
}

/**
 * Derives the user's Supabase SQL-editor URL from SUPABASE_URL so the banner
 * can deep-link them to where they need to paste the schema.
 */
export function supabaseSqlEditorUrl(): string | null {
  const m = env.SUPABASE_URL.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (!m) return null;
  return `https://supabase.com/dashboard/project/${m[1]}/sql/new`;
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
