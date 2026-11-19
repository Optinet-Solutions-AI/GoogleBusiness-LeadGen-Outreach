/**
 * apify-run.ts — run one Apify robot (actor) with a spending cap and return its rows (19 Nov 2026).
 *
 * Inputs:  actor id ("owner~name"), its input, a USD spending cap, optional stop check; env.APIFY_TOKEN
 * Outputs: { items, status, usageUsd } — the dataset rows, the run's final status, what Apify charged; throws
 *          ApifyRunError (Apify's own message) when the run can't start, or fails / times out with no rows
 * Used by: lib/services/trustpilot.ts, lib/services/tripadvisor.ts (review-site sources)
 */
import "@/lib/server-guard";
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("apify.run");
const BASE_URL = "https://api.apify.com/v2";
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const DEADLINE_MS = 8 * 60 * 1000;

export class ApifyRunError extends Error {}

interface RunData {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number | null;
}

export async function runActor<T>(opts: {
  actor: string;
  input: Record<string, unknown>;
  /** Apify stops charging (and the robot stops) at this amount. */
  maxChargeUsd: number;
  /** Checked each poll; true = abort the run and return what it found so far. */
  shouldStop?: () => boolean;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ items: T[]; status: string; usageUsd: number | null }> {
  if (!env.APIFY_TOKEN) throw new ApifyRunError("APIFY_TOKEN missing");
  const f = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? 5000;
  const token = encodeURIComponent(env.APIFY_TOKEN);
  const cap = Math.max(0.01, Math.round(opts.maxChargeUsd * 100) / 100);

  log.info({ actor: opts.actor, max_charge_usd: cap }, "apify.run.start");
  const startResp = await retry(() =>
    f(`${BASE_URL}/acts/${opts.actor}/runs?token=${token}&maxTotalChargeUsd=${cap}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.input),
    }),
  );
  const startBody = (await startResp.json().catch(() => ({}))) as { data?: RunData; error?: { message?: string } };
  if (!startResp.ok || !startBody.data) {
    const why = startBody.error?.message ?? `HTTP ${startResp.status}`;
    log.warn({ actor: opts.actor, status: startResp.status, why }, "apify.run.start_failed");
    throw new ApifyRunError(`The ${opts.actor} robot didn't start: ${why}`);
  }

  let run = startBody.data;
  const started = Date.now();
  while (!TERMINAL.has(run.status)) {
    if (opts.shouldStop?.()) {
      await f(`${BASE_URL}/actor-runs/${run.id}/abort?token=${token}`, { method: "POST" }).catch(() => undefined);
      log.info({ actor: opts.actor, run_id: run.id }, "apify.run.aborted_by_operator");
      break;
    }
    if (Date.now() - started > DEADLINE_MS) {
      await f(`${BASE_URL}/actor-runs/${run.id}/abort?token=${token}`, { method: "POST" }).catch(() => undefined);
      log.warn({ actor: opts.actor, run_id: run.id }, "apify.run.deadline");
      break;
    }
    if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
    const pollResp = await retry(() => f(`${BASE_URL}/actor-runs/${run.id}?token=${token}`));
    const polled = ((await pollResp.json().catch(() => ({}))) as { data?: RunData }).data;
    if (polled) run = polled;
  }

  const itemsResp = await retry(() => f(`${BASE_URL}/datasets/${run.defaultDatasetId}/items?clean=true&token=${token}`));
  const items = ((await itemsResp.json().catch(() => [])) as T[]) ?? [];
  const usageUsd = typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null;
  log.info({ actor: opts.actor, run_id: run.id, status: run.status, items: items.length, usage_usd: usageUsd }, "apify.run.done");

  if ((run.status === "FAILED" || run.status === "TIMED-OUT") && items.length === 0) {
    throw new ApifyRunError(`The ${opts.actor} robot ${run.status} and found nothing.`);
  }
  return { items, status: run.status, usageUsd };
}
