/**
 * gate.ts — should we send to this lead given its verification verdict?
 * Opt-in: when verification is inactive (no ZeroBounce key) everything sends.
 *
 * Inputs:  VerifyStatus | null, active boolean
 * Outputs: SendDecision ("send" | "skip" | "hold")
 * Used by: lib/pipeline/stage-5-email.ts, app/api/campaigns/[id]/launch/route.ts
 */
import type { VerifyStatus } from "../services/email-validator/types";

export type SendDecision = "send" | "skip" | "hold";

export function sendDecision(status: VerifyStatus | null, active: boolean): SendDecision {
  if (!active) return "send";
  if (status === "valid" || status === "catch-all") return "send";
  if (status === "invalid") return "skip";
  return "hold"; // unknown OR null (never verified)
}
