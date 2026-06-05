/**
 * dns-check.ts — stage 2: MX lookup (free). No MX → invalid. MX present →
 * unknown (defer) + the top MX host and a coarse provider classification used
 * later to decide whether an SMTP probe is worthwhile.
 *
 * Inputs:  domain string, optional injectable resolver (defaults to node:dns/promises resolveMx)
 * Outputs: MxResult (extends StageResult) with mxTop + providerType
 * Used by: lib/services/email-validator/orchestrator (future)
 */
import { resolveMx } from "node:dns/promises";
import type { StageResult } from "./types";

export type ProviderType = "google_workspace" | "outlook365" | "cpanel_or_other";

export function classifyProvider(mxTop: string): ProviderType {
  const h = mxTop.toLowerCase();
  if (h.includes("google.com") || h.includes("googlemail")) return "google_workspace";
  if (h.includes("outlook.com") || h.includes("protection.outlook")) return "outlook365";
  return "cpanel_or_other";
}

export interface MxResult extends StageResult {
  mxTop: string | null;
  providerType: ProviderType | null;
}

type Resolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

export async function checkMx(domain: string, resolver: Resolver = resolveMx): Promise<MxResult> {
  let records: { exchange: string; priority: number }[];
  try {
    records = await resolver(domain);
  } catch {
    // A DNS lookup FAILURE is not proof of "no MX" (it could be a transient
    // resolver/network hiccup). Per the no-guessing rule, defer rather than
    // condemn the address — fall through to the paid verifiers as `unknown`.
    return { status: "unknown", decisive: false, mxTop: null, providerType: null };
  }
  if (records.length === 0) {
    // Lookup SUCCEEDED but the domain genuinely has no MX → undeliverable.
    return { status: "invalid", decisive: true, mxTop: null, providerType: null };
  }
  const mxTop = records.sort((a, b) => a.priority - b.priority)[0].exchange;
  return {
    status: "unknown",
    decisive: false,
    mxTop,
    providerType: classifyProvider(mxTop),
  };
}
