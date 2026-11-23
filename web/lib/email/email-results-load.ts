/**
 * email/email-results-load.ts — the Templates page's Results: the scoreboard for a period + every wording test with
 * version A against version B.
 *
 * Inputs:  a period ("30" | "90" | "all" days)
 * Outputs: { rows, tests: [{ ...test, a, b, enough }], testsMissing }
 * Used by: app/api/email-results/route.ts
 *
 * Counting rules: lib/email/email-results.ts (pure). All sends are read so each reply goes to the email right before
 * it; only the period's sends are shown.
 */
import "@/lib/server-guard";
import { loadResponses, loadSends } from "./email-events";
import { listTests } from "./email-tests";
import { resultRows, testResult, type ResultRow } from "./email-results";
import type { WordingTest } from "./wording-test";

export type Period = "30" | "90" | "all";

export interface ResultsView {
  rows: ResultRow[];
  tests: (WordingTest & { a: ResultRow; b: ResultRow; enough: boolean })[];
  testsMissing: boolean;
}

export async function loadEmailResults(period: Period, now: number = Date.now()): Promise<ResultsView> {
  const since = period === "all" ? null : new Date(now - Number(period) * 86_400_000).toISOString();
  const [{ tests, missing }, sends, responses] = await Promise.all([
    listTests().catch(() => ({ tests: [] as WordingTest[], missing: false })),
    loadSends(null),
    loadResponses(null),
  ]);
  return {
    rows: resultRows(sends, responses, since),
    tests: tests.map((t) => ({ ...t, ...testResult(t.id, sends, responses) })),
    testsMissing: missing,
  };
}
