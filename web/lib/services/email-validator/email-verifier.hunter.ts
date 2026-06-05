/**
 * email-verifier.hunter.ts — stage 7 (last resort). Skips free-webmail domains
 * (the call adds nothing, burns a credit) + a per-process hourly cap.
 *
 * Inputs:  email string, env.HUNTER_API_KEY, env.HUNTER_MAX_CALLS_PER_HOUR
 * Outputs: { status: VerifyStatus; raw: string } | null (null when no key / webmail / cap hit)
 * Used by: lib/services/email-validator/orchestrator (ladder stage 7)
 */
import { env } from "../../config";
import { getLogger } from "../../logger";
import { retry } from "../../retry";
import type { VerifyStatus } from "./types";

const log = getLogger("verify.hunter");
const BASE = "https://api.hunter.io/v2/email-verifier";
const WEBMAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com"]);

let windowStart = 0; // epoch ms of the current hour window
let callsThisHour = 0;

export function isWebmail(email: string): boolean {
  return WEBMAIL.has((email.split("@")[1] ?? "").toLowerCase());
}

export function mapHunter(status: string, result: string): VerifyStatus {
  if (status === "invalid" || result === "undeliverable") return "invalid";
  if (status === "accept_all") return "catch-all";
  if (status === "valid" && result === "deliverable") return "valid";
  return "unknown";
}

export async function verifyHunter(
  email: string,
  now: number = Date.now(),
): Promise<{ status: VerifyStatus; raw: string } | null> {
  if (!env.HUNTER_API_KEY || isWebmail(email)) return null;
  if (now - windowStart > 3_600_000) { windowStart = now; callsThisHour = 0; }
  if (callsThisHour >= env.HUNTER_MAX_CALLS_PER_HOUR) {
    log.warn({ email }, "hunter.hourly_cap");
    return null;
  }
  callsThisHour += 1;
  const url = `${BASE}?email=${encodeURIComponent(email)}&api_key=${env.HUNTER_API_KEY}`;
  const resp = await retry(() => fetch(url), { maxAttempts: 2 });
  if (!resp.ok) return { status: "unknown", raw: `http_${resp.status}` };
  const data = (await resp.json()) as { data?: { status?: string; result?: string } };
  const status = data.data?.status ?? "unknown";
  const result = data.data?.result ?? "unknown";
  return { status: mapHunter(status, result), raw: `${status}/${result}` };
}
