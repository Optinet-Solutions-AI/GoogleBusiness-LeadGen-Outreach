import { describe, it, expect } from "vitest";
import { checkSyntax } from "./syntax-check";

describe("checkSyntax", () => {
  it("accepts a normal address", () => {
    expect(checkSyntax("jane@example.com").status).toBe("unknown"); // syntax OK → defer
    expect(checkSyntax("jane@example.com").decisive).toBe(false);
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["", "no-at", "a@b", "a@@b.com", "a b@c.com", "a@b.c "]) {
      const r = checkSyntax(bad);
      expect(r.status).toBe("invalid");
      expect(r.decisive).toBe(true);
    }
  });
});
