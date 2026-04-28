/**
 * retry.ts — Reusable retry wrapper with exponential backoff.
 *
 * Inputs:  any async function that hits a flaky external API
 * Outputs: same fn, retried up to N times on failure
 * Used by: lib/services/*
 */

import { getLogger } from "./logger";

const log = getLogger("retry");

export interface RetryOptions {
  maxAttempts?: number;
  initialMs?: number;
  maxMs?: number;
  retryOn?: (err: unknown) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 4, initialMs = 1000, maxMs = 30_000, retryOn = () => true } = opts;
  let attempt = 0;
  let wait = initialMs;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !retryOn(err)) throw err;
      log.warn({ attempt, wait, err: String(err) }, "retry.backoff");
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, maxMs);
    }
  }
}
