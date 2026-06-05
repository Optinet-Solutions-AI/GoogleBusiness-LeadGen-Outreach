/**
 * syntax-check.ts — stage 1: free, instant RFC-ish syntax gate.
 *
 * Inputs:  an email string (untrusted, may be empty or malformed)
 * Outputs: StageResult — status "unknown"/non-decisive when syntax passes,
 *          "invalid"/decisive when it fails
 * Used by: lib/services/email-validator/orchestrator.ts (future)
 *
 * Syntax OK is NOT proof of deliverability → returns unknown/non-decisive.
 */
import type { StageResult } from "./types";

// Pragmatic address regex: local@domain.tld, no spaces, a real TLD label.
const RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

export function checkSyntax(email: string): StageResult {
  const ok = RE.test(email.trim());
  return ok ? { status: "unknown", decisive: false } : { status: "invalid", decisive: true };
}
