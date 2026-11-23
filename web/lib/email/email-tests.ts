/**
 * email/email-tests.ts — start, list and end wording tests (table email_tests, migration 066).
 *
 * Inputs:  { service_key, a_key, b_key } to start; a test id + the winner ("A" | "B") to end
 * Outputs: listTests() · getTest(id) · startTest(input) · endTest(id, winner) · runningWithCounts() ·
 *          runningWithNext() (which version
 *          Send email fills next for each running test); refusals as plain sentences (TestError)
 * Used by: app/api/email-tests/**, lib/email/compose-context.ts, lib/email/email-used.ts, lib/email/email-results-load.ts
 *
 * Rules live in lib/email/wording-test.ts (pure). The table may be missing until 066 runs: reads then return nothing
 * and starting a test says to run it.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { SERVICES } from "@/lib/email/service-templates";
import { listTemplates } from "@/lib/email/template-library";
import { loadSends } from "@/lib/email/email-events";
import { usedOf } from "./email-results";
import { nextVariant, startTestRefusal, type Variant, type WordingTest } from "./wording-test";

const log = getLogger("email-tests");

export const MISSING_066 = "Wording tests need database update 066 (run db/migrations/066_email_tests.sql in Supabase).";
const COLS = "id,service_key,a_key,b_key,a_label,b_label,status,winner,started_at,ended_at";

export class TestError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "TestError";
  }
}

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("email_tests") && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

export async function listTests(): Promise<{ tests: WordingTest[]; missing: boolean }> {
  const { data, error } = await getDb().from("email_tests").select(COLS).order("started_at", { ascending: false }).limit(200);
  if (error) {
    if (isMissingTable(error.message)) return { tests: [], missing: true };
    throw new Error(error.message);
  }
  return { tests: (data ?? []) as WordingTest[], missing: false };
}

export async function getTest(id: string): Promise<WordingTest | null> {
  const { data, error } = await getDb().from("email_tests").select(COLS).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return (data as WordingTest | null) ?? null;
}

export async function startTest(input: { service_key: string; a_key: string; b_key: string }): Promise<WordingTest> {
  const [{ tests, missing }, { templates }] = await Promise.all([listTests(), listTemplates({ includeArchived: true })]);
  if (missing) throw new TestError(MISSING_066, 503);
  const refusal = startTestRefusal(input, tests, templates);
  if (refusal) throw new TestError(refusal);
  const label = (key: string) => {
    if (key.startsWith("service:")) return `Ready-made: ${SERVICES.find((s) => `service:${s.key}` === key)?.label ?? key}`;
    const t = templates.find((x) => `saved:${x.id}` === key);
    return t ? t.name : "A saved template";
  };
  const { data, error } = await getDb()
    .from("email_tests")
    .insert({ ...input, a_label: label(input.a_key), b_label: label(input.b_key), status: "running" })
    .select(COLS)
    .single();
  if (error) {
    if (isMissingTable(error.message)) throw new TestError(MISSING_066, 503);
    // Two starts at once: the one-running-test-per-offer index refuses the second.
    if (/duplicate key|unique/i.test(error.message)) throw new TestError("This offer already has a wording test running. End it first.");
    throw new Error(error.message);
  }
  log.info({ test_id: (data as WordingTest).id, service_key: input.service_key }, "email_test.started");
  return data as WordingTest;
}

export async function endTest(id: string, winner: Variant): Promise<WordingTest> {
  const { data, error } = await getDb()
    .from("email_tests")
    .update({ status: "done", winner, ended_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "running")
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_066 : error.message);
  if (!data) throw new TestError("That test has already ended.");
  log.info({ test_id: id, winner }, "email_test.ended");
  return data as WordingTest;
}

/** Each running test with how many sends each version has so far. */
export async function runningWithCounts(): Promise<(WordingTest & { sentA: number; sentB: number })[]> {
  const { tests } = await listTests().catch(() => ({ tests: [] as WordingTest[] }));
  const running = tests.filter((t) => t.status === "running");
  if (!running.length) return [];
  const since = running.reduce((a, t) => (t.started_at < a ? t.started_at : a), running[0].started_at);
  const sends = await loadSends(since).catch(() => []);
  return running.map((t) => {
    let sentA = 0;
    let sentB = 0;
    for (const s of sends) {
      const u = usedOf(s.meta);
      if (u.test_id !== t.id) continue;
      if (u.variant === "A") sentA++;
      else if (u.variant === "B") sentB++;
    }
    return { ...t, sentA, sentB };
  });
}

/** Each running test with the version Send email fills next (the one with fewer sends so far). */
export async function runningWithNext(): Promise<(WordingTest & { next: Variant })[]> {
  return (await runningWithCounts()).map((t) => ({ ...t, next: nextVariant(t.sentA, t.sentB) }));
}

/** Per offer, the saved template that won its last finished test (Send email starts with it). */
export function winnersByOffer(tests: WordingTest[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of [...tests].sort((x, y) => (y.ended_at ?? "").localeCompare(x.ended_at ?? ""))) {
    if (t.status !== "done" || !t.winner || out[t.service_key]) continue;
    out[t.service_key] = t.winner === "A" ? t.a_key : t.b_key;
  }
  return out;
}
