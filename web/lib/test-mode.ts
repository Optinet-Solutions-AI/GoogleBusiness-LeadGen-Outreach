/**
 * test-mode.ts — read the Test mode setting (migration 075, table app_settings, key 'test_mode').
 *
 * Inputs:  app_settings row 'test_mode' { on, emails, phones, hosts }
 * Outputs: getTestMode() → TestMode (cached 30 s per process); fail-closed: a missing table / row or a read error is
 *          ON with empty lists (nothing can be sent); setTestMode() for the operator's script
 * Used by: the Test list page (app/api/test-mode: QA adds / removes their own email or phone), every send point (lib/services/{email-sender,voizo,mobivate}.ts, lib/contact-form/runs.ts,
 *          lib/pipeline/call-scheduler.ts, lib/calls/quick-call.ts, lib/campaigns/batch-email-plan.ts,
 *          lib/brain/approve.ts), the dashboard banner, web/scripts/test-mode.ts
 *
 * The app has no switch for it: the operator changes it by asking (web/scripts/test-mode.ts, run by Claude).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { CLOSED, addContact, parseTestMode, removeContact, type ContactKind, type TestMode } from "./test-mode-rules";

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

/**
 * QA edits the test list from the Test list page (operator, 26 Nov 2026): add / remove an email or a phone. Reads the
 * row fresh and refuses when it can't be read (a failed read must never turn into an empty list that gets saved).
 * Test mode's on / off and the website list are never changed here.
 */
export async function editTestList(
  action: "add" | "remove",
  kind: ContactKind,
  value: string,
): Promise<{ ok: true; mode: TestMode } | { ok: false; message: string }> {
  const { data, error } = await getDb().from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error || !data) return { ok: false, message: "The test list can't be read right now (database update 075 run?). Nothing was changed." };
  const current = parseTestMode((data as { value: unknown }).value);
  let next: TestMode;
  if (action === "add") {
    const r = addContact(current, kind, value);
    if (!r.ok) return r;
    next = r.mode;
  } else next = removeContact(current, kind, value);
  await setTestMode(next);
  log.info({ action, kind }, "test_mode.list_edited");
  return { ok: true, mode: next };
}

/** Tests only: forget the cached setting. */
export function resetTestModeCache(): void {
  cache = null;
}
