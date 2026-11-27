import { describe, expect, it } from "vitest";
import { isPublicHost, linkKind, linkVerdict } from "./link-check";

describe("linkKind", () => {
  it("social sites can't be checked automatically (they block it, and we never get around it)", () => {
    for (const u of ["https://www.linkedin.com/in/joe", "https://facebook.com/joes", "https://m.facebook.com/x", "https://instagram.com/joe", "https://x.com/joe", "https://twitter.com/joe", "https://www.tiktok.com/@joe"]) {
      expect(linkKind(u), u).toBe("social");
    }
    expect(linkKind("https://joesplumbing.com/contact")).toBe("web");
    expect(linkKind("not a url")).toBe("invalid");
    expect(linkKind("ftp://joes.com/contact")).toBe("invalid");
    expect(linkKind("http://169.254.169.254/computeMetadata/v1/")).toBe("internal");
    expect(linkKind("http://localhost:3000/x")).toBe("internal");
  });
});

describe("linkVerdict", () => {
  it("opens: a 2xx after redirects", () => {
    expect(linkVerdict({ status: 200 })).toBe("ok");
    expect(linkVerdict({ status: 204 })).toBe("ok");
  });
  it("doesn't open: page gone, or the address doesn't exist", () => {
    expect(linkVerdict({ status: 404 })).toBe("dead");
    expect(linkVerdict({ status: 410 })).toBe("dead");
    expect(linkVerdict({ error: "ENOTFOUND" })).toBe("dead");
    expect(linkVerdict({ error: "ECONNREFUSED" })).toBe("dead");
  });
  it("can't tell: blocked, rate-limited, server trouble or a timeout is never called dead", () => {
    for (const status of [401, 403, 429, 999, 500, 503]) expect(linkVerdict({ status }), String(status)).toBe("unknown");
    expect(linkVerdict({ error: "timeout" })).toBe("unknown");
    expect(linkVerdict({})).toBe("unknown");
  });
});

describe("isPublicHost (never open internal addresses)", () => {
  it("refuses loopback, private, link-local and internal names", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "[::1]", "metadata.google.internal", "foo.internal", "fd00::1"]) {
      expect(isPublicHost(h), h).toBe(false);
    }
    for (const h of ["joesplumbing.com", "8.8.8.8", "172.32.0.1", "www.example.co.uk"]) expect(isPublicHost(h), h).toBe(true);
  });
});
