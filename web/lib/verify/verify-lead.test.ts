import { describe, it, expect } from "vitest";
import { buildLeadUpdate } from "./verify-lead";

describe("buildLeadUpdate", () => {
  it("maps a verify result to lead columns", () => {
    const u = buildLeadUpdate({
      email: "a@acme.com", status: "valid", decided_by: "zerobounce",
      audit: { syntax_ok: true, mx_ok: true, smtp_result: "disabled", zerobounce_result: "valid", millionverifier_result: null, hunter_result: null },
    }, "2026-06-05T00:00:00Z");
    expect(u).toEqual({
      verification_status: "valid",
      email_verified: true,
      verified_at: "2026-06-05T00:00:00Z",
      verify_syntax_ok: true,
      verify_mx_ok: true,
      verify_smtp_result: "disabled",
      verify_zerobounce_result: "valid",
      verify_millionverifier_result: null,
      verify_hunter_result: null,
    });
  });
  it("email_verified is false for non-valid", () => {
    const u = buildLeadUpdate({ email: "x", status: "invalid", decided_by: "mx",
      audit: { syntax_ok: true, mx_ok: false, smtp_result: null, zerobounce_result: null, millionverifier_result: null, hunter_result: null } }, "t");
    expect(u.email_verified).toBe(false);
  });
});
