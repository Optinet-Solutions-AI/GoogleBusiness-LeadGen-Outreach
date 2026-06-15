import { describe, it, expect } from "vitest";
import { buildFilterUrl } from "./url-params";

describe("buildFilterUrl", () => {
  it("returns the base path when no params are active", () => {
    expect(buildFilterUrl("/leads", {}, {})).toBe("/leads");
  });

  it("preserves sibling params when patching one", () => {
    expect(
      buildFilterUrl("/leads", { stage: "replied", verify: "valid" }, { email: "has" }),
    ).toBe("/leads?stage=replied&verify=valid&email=has");
  });

  it("drops a key when the patch value is undefined or empty", () => {
    expect(
      buildFilterUrl("/leads", { stage: "replied", email: "has" }, { email: undefined }),
    ).toBe("/leads?stage=replied");
    expect(
      buildFilterUrl("/leads", { stage: "replied", email: "has" }, { email: "" }),
    ).toBe("/leads?stage=replied");
  });

  it("lets the patch override an existing value", () => {
    expect(buildFilterUrl("/leads", { stage: "replied" }, { stage: "dead" })).toBe(
      "/leads?stage=dead",
    );
  });
});
