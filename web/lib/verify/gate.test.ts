import { describe, it, expect } from "vitest";
import { sendDecision } from "./gate";

describe("sendDecision", () => {
  it("no-ops to send when verification inactive", () => {
    expect(sendDecision("invalid", false)).toBe("send"); // gate off
  });
  it("blocks invalid, holds unknown + null, sends valid + catch-all when active", () => {
    expect(sendDecision("valid", true)).toBe("send");
    expect(sendDecision("catch-all", true)).toBe("send");
    expect(sendDecision("invalid", true)).toBe("skip");
    expect(sendDecision("unknown", true)).toBe("hold");
    expect(sendDecision(null, true)).toBe("hold");
  });
});
