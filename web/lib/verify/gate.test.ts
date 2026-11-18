import { describe, it, expect } from "vitest";
import { sendDecision } from "./gate";

describe("sendDecision", () => {
  it("sends unchecked addresses when verification is off, but never one already known to be bad", () => {
    expect(sendDecision(null, false)).toBe("send");
    expect(sendDecision("unknown", false)).toBe("send");
    expect(sendDecision("invalid", false)).toBe("skip");
  });
  it("blocks invalid, holds unknown + null, sends valid + catch-all when active", () => {
    expect(sendDecision("valid", true)).toBe("send");
    expect(sendDecision("catch-all", true)).toBe("send");
    expect(sendDecision("likely", true)).toBe("send"); // passed the free checks (18 Nov 2026)
    expect(sendDecision("invalid", true)).toBe("skip");
    expect(sendDecision("unknown", true)).toBe("hold");
    expect(sendDecision(null, true)).toBe("hold");
  });
});
