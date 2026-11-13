/**
 * email-verifier.zerobounce.ts — ZeroBounce verifier (primary paid stage).
 *
 * Inputs:  email string, env.ZEROBOUNCE_API_KEY
 * Outputs: { status: VerifyStatus; raw: string } | null (null when no key)
 * Used by: lib/services/email-validator/orchestrator (ladder stage 5)
 */

import { env } from "../../config";
import { getLogger } from "../../logger";
import { retry } from "../../retry";
import type { VerifyStatus } from "./types";

const log = getLogger("verify.zerobounce");
const BASE = "https://api.zerobounce.net/v2";

/**
 * Maps ZeroBounce's status/sub_status taxonomy to our 4-value VerifyStatus.
 * Conservative: never upgrades to "valid" without explicit proof.
 */
export function mapZeroBounce(status: string, subStatus?: string): VerifyStatus {
  switch (status) {
    case "valid":
      return "valid";
    case "invalid":
      return "invalid";
    case "catch-all":
      return "catch-all";
    case "spamtrap":
    case "abuse":
      return "invalid";
    case "toxic":
      return "unknown";
    case "do_not_mail":
      return subStatus === "global_suppression" || subStatus === "possible_trap"
        ? "invalid"
        : "catch-all";
    default:
      return "unknown";
  }
}

/**
 * Calls the ZeroBounce validate endpoint and returns the mapped verdict plus
 * the raw ZB status string (for the audit trail). Returns null when no API key
 * is configured — the ladder will skip this stage gracefully.
 */
export async function verifyZeroBounce(
  email: string,
): Promise<{ status: VerifyStatus; raw: string } | null> {
  if (!env.ZEROBOUNCE_API_KEY) return null;

  const url = `${BASE}/validate?api_key=${env.ZEROBOUNCE_API_KEY}&email=${encodeURIComponent(email)}`;

  const resp = await retry(() => fetch(url), { maxAttempts: 3 });

  if (!resp.ok) {
    log.warn({ email, status: resp.status }, "zerobounce.http_error");
    return { status: "unknown", raw: `http_${resp.status}` };
  }

  const data = (await resp.json().catch(() => ({}))) as { status?: string; sub_status?: string; error?: string };
  if (!data.status) {
    // Out of credits / bad key: ZeroBounce answers 200 with { error } and no verdict. Say so in the audit trail
    // ("no_credits"), so the operator is told the checker is empty instead of "couldn't confirm the address";
    // the ladder moves on to the next verifier.
    const raw = zeroBounceErrorRaw(data.error);
    log.warn({ email, raw }, "zerobounce.no_verdict");
    return { status: "unknown", raw };
  }
  return { status: mapZeroBounce(data.status, data.sub_status), raw: data.status };
}

/** Audit value for a ZeroBounce reply without a verdict. */
export function zeroBounceErrorRaw(error: string | undefined): string {
  return error && /credit/i.test(error) ? "no_credits" : "error";
}
