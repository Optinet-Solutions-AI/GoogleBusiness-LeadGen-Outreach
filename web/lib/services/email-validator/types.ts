/**
 * types.ts — shared types for the email-verification ladder.
 *
 * Inputs:  nothing (type declarations only)
 * Outputs: VerifyStatus, StageResult, VerifyResult
 * Used by: every stage in lib/services/email-validator/
 */
export type VerifyStatus = "valid" | "invalid" | "catch-all" | "unknown";

export interface StageResult {
  status: VerifyStatus;
  /** true when the stage produced a definitive answer the orchestrator can stop on. */
  decisive: boolean;
}

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  /** Which stage produced the final verdict, e.g. "syntax" | "mx" | "zerobounce". */
  decided_by: string;
  audit: {
    syntax_ok: boolean | null;
    mx_ok: boolean | null;
    smtp_result: string | null;
    zerobounce_result: string | null;
    millionverifier_result: string | null;
    hunter_result: string | null;
  };
}
