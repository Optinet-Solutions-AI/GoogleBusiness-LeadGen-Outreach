/**
 * catch-all-probe.ts — stage 3: does the domain accept a random mailbox? A 250
 * for a guaranteed-nonexistent local-part = catch-all. No-ops to unknown when
 * port 25 is blocked. Caller caches the answer per-domain (7 days).
 *
 * Inputs:  domain string, MX hostname, opts.enabled flag
 * Outputs: StageResult + raw diagnostic string
 * Used by: email-validator orchestrator
 */
import { smtpProbe } from "./smtp-probe";
import type { StageResult } from "./types";

export async function catchAllProbe(
  domain: string,
  mxHost: string,
  opts: { enabled?: boolean } = {},
): Promise<StageResult & { raw: string }> {
  const random = `verify-probe-${Math.random().toString(36).slice(2, 12)}@${domain}`;
  const r = await smtpProbe(random, mxHost, opts);
  // A "valid" verdict for a random address means the domain accepts everything.
  if (r.status === "valid") return { status: "catch-all", decisive: true, raw: "accepts_random" };
  return { status: "unknown", decisive: false, raw: r.raw };
}
