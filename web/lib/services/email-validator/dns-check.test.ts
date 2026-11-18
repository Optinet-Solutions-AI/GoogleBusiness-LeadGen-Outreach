import { describe, it, expect } from "vitest";
import { checkMx, classifyProvider } from "./dns-check";

describe("classifyProvider", () => {
  it("detects google + outlook + other", () => {
    expect(classifyProvider("aspmx.l.google.com")).toBe("google_workspace");
    expect(classifyProvider("foo.mail.protection.outlook.com")).toBe("outlook365");
    expect(classifyProvider("mail.acme.com")).toBe("cpanel_or_other");
  });
});

describe("checkMx", () => {
  it("invalid when the lookup succeeds but returns no MX records", async () => {
    const r = await checkMx("example.com", async () => []);
    expect(r.status).toBe("invalid");
    expect(r.decisive).toBe(true);
  });
  it("unknown (non-decisive) when the MX lookup FAILS (timeout — not proof of no-MX)", async () => {
    const r = await checkMx("example.com", async () => {
      throw Object.assign(new Error("queryMx ETIMEOUT"), { code: "ETIMEOUT" });
    });
    expect(r.status).toBe("unknown");
    expect(r.decisive).toBe(false);
  });
  it("invalid when the domain doesn't exist or has no mail records (expired company domain)", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      const r = await checkMx("expired-co.com", async () => {
        throw Object.assign(new Error(`queryMx ${code}`), { code });
      });
      expect(r, code).toMatchObject({ status: "invalid", decisive: true });
    }
  });
  it("non-decisive unknown when MX exists", async () => {
    const r = await checkMx("example.com", async () => [{ exchange: "mail.acme.com", priority: 10 }]);
    expect(r.status).toBe("unknown");
    expect(r.decisive).toBe(false);
    expect(r.mxTop).toBe("mail.acme.com");
    expect(r.providerType).toBe("cpanel_or_other");
  });
});
