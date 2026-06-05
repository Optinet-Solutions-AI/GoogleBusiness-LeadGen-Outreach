/**
 * email-verifier.millionverifier.ts — stage 6 (Tier 2). Fires only on unknown + key set.
 *
 * Inputs:  email string, env.MILLIONVERIFIER_API_KEY
 * Outputs: { status: VerifyStatus; raw: string } | null (null when no key)
 * Used by: lib/services/email-validator/orchestrator (ladder stage 6)
 */

import { env } from "../../config";
import { getLogger } from "../../logger";
import { retry } from "../../retry";
import type { VerifyStatus } from "./types";

const log = getLogger("verify.millionverifier");
const BASE = "https://api.millionverifier.com/api/v3";

export function mapMillionVerifier(result: string): VerifyStatus {
  switch (result) {
    case "ok": return "valid";
    case "invalid": return "invalid";
    case "catch_all": return "catch-all";
    case "disposable": return "unknown";
    default: return "unknown";
  }
}

export async function verifyMillionVerifier(
  email: string,
): Promise<{ status: VerifyStatus; raw: string } | null> {
  if (!env.MILLIONVERIFIER_API_KEY) return null;
  const url = `${BASE}/?api=${env.MILLIONVERIFIER_API_KEY}&email=${encodeURIComponent(email)}`;
  const resp = await retry(() => fetch(url), { maxAttempts: 3 });
  if (!resp.ok) {
    log.warn({ email, status: resp.status }, "millionverifier.http_error");
    return { status: "unknown", raw: `http_${resp.status}` };
  }
  const data = (await resp.json()) as { result?: string };
  const raw = data.result ?? "unknown";
  return { status: mapMillionVerifier(raw), raw };
}
