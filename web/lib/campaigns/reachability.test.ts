import { describe, it, expect } from "vitest";
import { isReachable, partitionForChannel } from "./reachability";

const lead = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "L1",
  email: null as string | null,
  phone: null as string | null,
  website_kind: null as string | null,
  ...over,
});

describe("isReachable", () => {
  it("email needs an email", () => {
    expect(isReachable(lead({ email: "a@b.com" }), "email")).toBe(true);
    expect(isReachable(lead({ email: null }), "email")).toBe(false);
  });
  it("sms + voice need a phone", () => {
    expect(isReachable(lead({ phone: "+1555" }), "sms")).toBe(true);
    expect(isReachable(lead({ phone: "+1555" }), "voice_agent")).toBe(true);
    expect(isReachable(lead({ phone: null }), "sms")).toBe(false);
  });
  it("dm needs a social website_kind", () => {
    expect(isReachable(lead({ website_kind: "instagram" }), "dm")).toBe(true);
    expect(isReachable(lead({ website_kind: "real" }), "dm")).toBe(false);
  });
});

describe("partitionForChannel", () => {
  it("splits eligible vs not_reachable", () => {
    const leads = [
      lead({ id: "A", email: "a@b.com" }),
      lead({ id: "B", email: null }),
    ];
    const { eligible, skipped } = partitionForChannel(leads, "email");
    expect(eligible.map((l) => l.id)).toEqual(["A"]);
    expect(skipped.not_reachable).toEqual(["B"]);
  });
});
