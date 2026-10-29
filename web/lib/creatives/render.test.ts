/**
 * render.test.ts — slideCount clamp rules for creative rendering.
 *
 * Inputs:  hand-built CreativeInputs
 * Outputs: vitest assertions
 * Used by: vitest
 */
import { describe, expect, it } from "vitest";
import {
  fitOutcome,
  fontsFromProfile,
  RenderInputError,
  slideCount,
} from "./render";
import type { CreativeInputs } from "./types";

const base: CreativeInputs = {
  headline: "h",
  subhead: "s",
  cta_text: "c",
  cta_kind: "call",
  colors: {
    primary: "#111111",
    accent: "#222222",
    background: "#ffffff",
    text: "#000000",
  },
  logo_asset_id: null,
  photo_asset_ids: [],
  background_asset_id: null,
  background_prompt: null,
};
const slides = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ headline: `h${i}`, subhead: "s" }));

describe("slideCount", () => {
  it("image is a single unnumbered render", () =>
    expect(slideCount("image", base)).toEqual([null]));
  it("carousel with 3-5 slides numbers them from 1", () => {
    expect(slideCount("carousel", { ...base, slides: slides(3) })).toEqual([
      1, 2, 3,
    ]);
    expect(slideCount("carousel", { ...base, slides: slides(5) })).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
  it("clamps to 5", () =>
    expect(slideCount("carousel", { ...base, slides: slides(8) })).toHaveLength(
      5,
    ));
  it("throws under 3", () => {
    expect(() =>
      slideCount("carousel", { ...base, slides: slides(2) }),
    ).toThrow(RenderInputError);
    expect(() => slideCount("carousel", base)).toThrow(RenderInputError);
  });
});

describe("fitOutcome", () => {
  it("classifies the fit report", () => {
    expect(fitOutcome("ok")).toBe("ok");
    expect(fitOutcome("overflow")).toBe("overflow");
    expect(fitOutcome(null)).toBe("timeout");
  });
});

describe("fontsFromProfile", () => {
  const f = (value: string) => ({
    value,
    source: { kind: "operator" } as never,
    confirmed: true,
  });
  it("maps serif faces to serif, else sans", () => {
    expect(
      fontsFromProfile({ heading: f("Playfair Display"), body: f("Inter") }),
    ).toEqual({ heading: "serif", body: "sans" });
    expect(
      fontsFromProfile({ heading: f("Source Serif 4"), body: f("Open Sans") }),
    ).toEqual({ heading: "serif", body: "sans" });
    expect(fontsFromProfile({ heading: null, body: null })).toEqual({
      heading: "sans",
      body: "sans",
    });
    expect(fontsFromProfile(undefined)).toEqual({
      heading: "sans",
      body: "sans",
    });
  });
});
