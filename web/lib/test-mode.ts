/**
 * test-mode.ts — read the Test mode setting (migration 075, table app_settings, key 'test_mode').
 *
 * Inputs:  app_settings row 'test_mode' { on, emails, phones, hosts }
 * Outputs: getTestMode() → TestMode (cached 30 s per process); fail-closed: a missing table / row or a read error is
 *          ON with empty lists (nothing can be sent); setTestMode() for the operator's script
 * Used by: every send point (lib/services/{email-sender,voizo,mobivate}.ts, lib/contact-form/runs.ts,
 *          lib/pipeline/call-scheduler.ts, lib/calls/quick-call.ts, lib/campaigns/batch-email-plan.ts,
 *          lib/brain/approve.ts), the dashboard banner, web/scripts/test-mode.ts
 *
 * The app has no switch for it: the operator changes it by asking (web/scripts/test-mode.ts, run by Claude).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { CLOSED, parseTestMode, type TestMode } from "./test-mode-rules";

export { TEST_MODE_TEXT, allowEmail, allowPhone, allowUrl, type TestMode } from "./test-mode-rules";

const log = getLogger("test-mode");
const KEY = "test_mode";
const TTL_MS = 30_000;
let cache: { at: number; mode: TestMode } | null = null;

export async function getTestMode(): Promise<TestMode> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.mode;
  let mode: TestMode = CLOSED;
  try {
    const { data, error } = await getDb().from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (error) log.warn({ err: error.message }, "test_mode.read_failed (closed: nothing is sent)");
    else mode = parseTestMode((data as { value: unknown } | null)?.value);
  } catch (err) {
    log.warn({ err: String(err) }, "test_mode.read_failed (closed: nothing is sent)");
  }
  cache = { at: Date.now(), mode };
  return mode;
}

/** For the operator's script only. */
export async function setTestMode(mode: TestMode): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: KEY, value: mode, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  cache = null;
}

/** Tests only: forget the cached setting. */
export function resetTestModeCache(): void {
  cache = null;
}
