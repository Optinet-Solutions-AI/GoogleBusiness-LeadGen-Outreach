/**
 * index.ts — the verification ladder. Runs cheap stages first, short-circuits on
 * a decisive verdict, falls through to paid verifiers, and never upgrades to
 * `valid` without explicit proof.
 *
 * Inputs:  email string, optional injected stage functions (production wiring uses real impls)
 * Outputs: VerifyResult (status, decided_by, audit trail)
 * Used by: lib/pipeline/stage-2-enrich.ts, lib/services/email-validator/index.test.ts
 */
import { env } from "../../config";
import { getLogger } from "../../logger";
import { checkSyntax } from "./syntax-check";
import { checkMx, type MxResult } from "./dns-check";
import { catchAllProbe } from "./catch-all-probe";
import { smtpProbe } from "./smtp-probe";
import { verifyZeroBounce } from "./email-verifier.zerobounce";
import { verifyMillionVerifier } from "./email-verifier.millionverifier";
import { verifyHunter } from "./email-verifier.hunter";
import { getDomainIntel, putDomainIntel } from "./domain-cache";
import type { StageResult, VerifyResult, VerifyStatus } from "./types";

const log = getLogger("verify.ladder");

export interface LadderStages {
  syntax: (email: string) => StageResult;
  mx: (domain: string) => Promise<MxResult>;
  catchAll: (domain: string, mx: string) => Promise<StageResult & { raw: string }>;
  smtp: (email: string, mx: string) => Promise<StageResult & { raw: string }>;
  zerobounce: (email: string) => Promise<{ status: VerifyStatus; raw: string } | null>;
  millionverifier: (email: string) => Promise<{ status: VerifyStatus; raw: string } | null>;
  hunter: (email: string) => Promise<{ status: VerifyStatus; raw: string } | null>;
}

export async function runLadder(email: string, s: LadderStages): Promise<VerifyResult> {
  const audit: VerifyResult["audit"] = {
    syntax_ok: null, mx_ok: null, smtp_result: null, zerobounce_result: null,
    millionverifier_result: null, hunter_result: null,
  };
  const finalize = (status: VerifyStatus, decided_by: string): VerifyResult =>
    ({ email, status, decided_by, audit });

  const syn = s.syntax(email);
  audit.syntax_ok = syn.status !== "invalid";
  if (syn.decisive) return finalize(syn.status, "syntax");

  const domain = email.split("@")[1] ?? "";
  const mx = await s.mx(domain);
  audit.mx_ok = mx.status !== "invalid";
  if (mx.decisive) return finalize(mx.status, "mx");
  const mxHost = mx.mxTop ?? "";

  // SMTP-based stages are skippable for the "giants" (they 250 everything — a
  // probe verdict would be a guess); those fall straight through to ZeroBounce.
  const giant = mx.providerType === "google_workspace" || mx.providerType === "outlook365";
  if (!giant && mxHost) {
    const ca = await s.catchAll(domain, mxHost);
    if (ca.decisive) { audit.smtp_result = ca.raw; return finalize(ca.status, "catch-all"); }
    const probe = await s.smtp(email, mxHost);
    audit.smtp_result = probe.raw;
    if (probe.decisive) return finalize(probe.status, "smtp");
  }

  // Paid verifiers, in cost/strength order. A definitive valid/invalid ends the
  // ladder immediately. A `catch-all` is NOT final — keep asking the next tier
  // for a second opinion (a verifier with mailbox-level data may resolve it),
  // remembering catch-all as the fallback if none can. Never upgrades to `valid`
  // without an explicit valid from a verifier ("no guessing" preserved).
  let fallback: VerifyStatus = "unknown";
  let fallbackBy = "exhausted";

  const zb = await s.zerobounce(email);
  if (zb) {
    audit.zerobounce_result = zb.raw;
    if (zb.status === "valid" || zb.status === "invalid") return finalize(zb.status, "zerobounce");
    if (zb.status === "catch-all") { fallback = "catch-all"; fallbackBy = "zerobounce"; }
  }
  const mv = await s.millionverifier(email);
  if (mv) {
    audit.millionverifier_result = mv.raw;
    if (mv.status === "valid" || mv.status === "invalid") return finalize(mv.status, "millionverifier");
    if (mv.status === "catch-all") { fallback = "catch-all"; fallbackBy = "millionverifier"; }
  }
  const hu = await s.hunter(email);
  if (hu) {
    audit.hunter_result = hu.raw;
    if (hu.status === "valid" || hu.status === "invalid") return finalize(hu.status, "hunter");
    if (hu.status === "catch-all") { fallback = "catch-all"; fallbackBy = "hunter"; }
  }

  return finalize(fallback, fallbackBy);
}

/** Production wiring. SMTP stages are enabled only when explicitly allowed (local backfill). */
export async function verifyEmail(
  email: string,
  opts: { smtpEnabled?: boolean } = {},
): Promise<VerifyResult> {
  const smtpEnabled = opts.smtpEnabled ?? false; // off in prod (port 25 blocked)
  const result = await runLadder(email, {
    syntax: checkSyntax,
    mx: checkMx,
    catchAll: async (d, mx) => {
      if (!smtpEnabled) return catchAllProbe(d, mx, { enabled: false });
      const cached = await getDomainIntel(d).catch(() => null);
      if (cached?.is_catch_all === true) return { status: "catch-all" as const, decisive: true, raw: "cached" };
      const r = await catchAllProbe(d, mx, { enabled: true });
      await putDomainIntel(d, {
        mx_top: mx,
        provider_type: null,
        is_catch_all: r.status === "catch-all" ? true : r.raw === "disabled" ? null : false,
      }).catch(() => undefined);
      return r;
    },
    smtp: (e, mx) => smtpProbe(e, mx, { enabled: smtpEnabled }),
    zerobounce: verifyZeroBounce,
    millionverifier: verifyMillionVerifier,
    hunter: verifyHunter,
  });
  log.info({ email, status: result.status, by: result.decided_by }, "verify.done");
  return result;
}

/** True when the send-gate should enforce (a paid verifier is configured). */
export function verificationActive(): boolean {
  return !!env.ZEROBOUNCE_API_KEY;
}
