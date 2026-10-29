/**
 * profile.test.ts — pure tests for version allocation and the featured-products cap.
 *
 * Inputs:  numbers, ProductSnapshot[] fixtures
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { allocateVersion, capFeatured, prepareProfileForSave, VersionConflictError } from "./profile";
import { EMPTY_PROFILE, type ProductSnapshot } from "./types";

describe("allocateVersion", () => {
  it("returns current + 1 when expected matches", () => expect(allocateVersion(3, 3)).toBe(4));
  it("throws VersionConflictError when expected differs", () => {
    expect(() => allocateVersion(3, 2)).toThrow(VersionConflictError);
  });
  it("returns current + 1 when expected is undefined", () => expect(allocateVersion(3, undefined)).toBe(4));
});

const prod = (name: string, sort: number, featured: boolean): ProductSnapshot => ({
  name,
  description: null,
  price: null,
  category: null,
  featured,
  sort,
  image_asset_ids: [],
  source: { kind: "operator" },
  confirmed: true,
});

describe("capFeatured", () => {
  it("keeps the first 10 featured by sort and unfeatures the rest", () => {
    const list = Array.from({ length: 12 }, (_, i) => prod(`p${i}`, 11 - i, true));
    const out = capFeatured(list);
    const kept = out.filter((p) => p.featured).map((p) => p.name);
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain("p0"); // sort 11
    expect(kept).not.toContain("p1"); // sort 10
    expect(out).toHaveLength(12);
  });
  it("leaves non-featured and small sets untouched", () => {
    const list = [prod("a", 0, true), prod("b", 1, false)];
    expect(capFeatured(list)).toEqual(list);
  });
});

describe("prepareProfileForSave", () => {
  it("caps featured products in the stored snapshot without mutating the input", () => {
    const products = Array.from({ length: 12 }, (_, i) => prod(`p${i}`, i, true));
    const input = { ...EMPTY_PROFILE, products };
    const out = prepareProfileForSave(input);
    expect(out.products.filter((p) => p.featured)).toHaveLength(10);
    expect(input.products.filter((p) => p.featured)).toHaveLength(12);
  });
});
