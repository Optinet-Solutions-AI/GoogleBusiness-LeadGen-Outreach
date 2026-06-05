import { describe, it, expect } from "vitest";
import { smtpProbe } from "./smtp-probe";

describe("smtpProbe", () => {
  it("returns unknown (non-decisive) when probing is disabled", async () => {
    const r = await smtpProbe("a@acme.com", "mail.acme.com", { enabled: false });
    expect(r.status).toBe("unknown");
    expect(r.decisive).toBe(false);
  });
});
