/**
 * profile-paths.test.ts — getPath/setPath/confirm helpers for the Brain editor.
 *
 * Inputs:  EMPTY_PROFILE-based fixtures
 * Outputs: vitest assertions
 * Used by: vitest
 */
import { describe, expect, it } from "vitest";
import { confirmGroup, confirmPath, getPath, PROFILE_GROUPS, setPath } from "./profile-paths";
import { EMPTY_PROFILE, type BrandProfileData } from "./types";

const f = (value: string, confirmed = false) => ({ value, source: { kind: "website" as const }, confirmed });

describe("getPath / setPath", () => {
  it("reads and writes a scalar path immutably", () => {
    const next = setPath(EMPTY_PROFILE, "business.tagline", f("Hi"));
    expect(getPath(next, "business.tagline")).toEqual(f("Hi"));
    expect(EMPTY_PROFILE.business.tagline).toBeNull();
    expect(next).not.toBe(EMPTY_PROFILE);
  });
  it("handles a [] list path", () => {
    const next = setPath(EMPTY_PROFILE, "claims.allowed[]", [f("a"), f("b")]);
    expect(getPath(next, "claims.allowed[]")).toHaveLength(2);
    expect(EMPTY_PROFILE.claims.allowed).toHaveLength(0);
  });
  it("throws on prototype segments", () => {
    expect(() => getPath(EMPTY_PROFILE, "__proto__.x")).toThrow();
    expect(() => setPath(EMPTY_PROFILE, "business.constructor.x", 1)).toThrow();
    expect(() => setPath(EMPTY_PROFILE, "prototype", 1)).toThrow();
  });
});

describe("confirm", () => {
  it("confirmPath confirms a single fact and list items", () => {
    let d: BrandProfileData = setPath(EMPTY_PROFILE, "business.name", f("A"));
    d = setPath(d, "claims.allowed[]", [f("x"), f("y")]);
    d = confirmPath(d, "business.name");
    d = confirmPath(d, "claims.allowed[]");
    expect(d.business.name?.confirmed).toBe(true);
    expect(d.claims.allowed.every((x) => x.confirmed)).toBe(true);
  });
  it("confirmGroup confirms every fact in the group and nothing else", () => {
    let d: BrandProfileData = setPath(EMPTY_PROFILE, "voice.style_notes", f("calm"));
    d = setPath(d, "voice.tone[]", [f("warm"), f("plain")]);
    d = setPath(d, "business.name", f("A"));
    const next = confirmGroup(d, "voice");
    expect(next.voice.style_notes?.confirmed).toBe(true);
    expect(next.voice.tone.every((x) => x.confirmed)).toBe(true);
    expect(next.business.name?.confirmed).toBe(false);
    expect(next.voice.do).toEqual([]);
  });
  it("rejects an unknown group", () => {
    expect(PROFILE_GROUPS.length).toBeGreaterThan(4);
    expect(() => confirmGroup(EMPTY_PROFILE, "nope")).toThrow();
  });
});
