/**
 * email-auth.test.ts — DMARC is looked up on the mailbox domain, then its parents (subdomains inherit it).
 *
 * Inputs:  domain names
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));

import { dmarcLookupOrder } from "./email-auth";

describe("dmarcLookupOrder", () => {
  it("checks the rp.* mailbox domain first, then the parent domain", () => {
    expect(dmarcLookupOrder("rp.rateupdigital.com")).toEqual(["rp.rateupdigital.com", "rateupdigital.com"]);
  });
  it("stops at two labels", () => {
    expect(dmarcLookupOrder("Example.com")).toEqual(["example.com"]);
    expect(dmarcLookupOrder("a.b.c.net")).toEqual(["a.b.c.net", "b.c.net", "c.net"]);
  });
});
