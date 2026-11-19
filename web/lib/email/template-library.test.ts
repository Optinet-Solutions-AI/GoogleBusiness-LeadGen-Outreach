/**
 * template-library.test.ts — the pure rules of saved email templates: what's valid, version numbers, restoring.
 *
 * Inputs:  sample template inputs and version lists
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no db in tests"); } }));

import { nextVersion, restorePatch, TemplateInputSchema } from "./template-library";

describe("TemplateInputSchema", () => {
  it("needs a name, subject and body; follow-ups default to empty", () => {
    expect(TemplateInputSchema.parse({ name: "Warm website", subject: "A site for {{business}}", body: "Hi {{first_name}}" })).toMatchObject({
      service_key: null,
      follow_up_1: "",
      follow_up_2: "",
    });
    expect(() => TemplateInputSchema.parse({ name: "", subject: "x", body: "y" })).toThrow();
    expect(() => TemplateInputSchema.parse({ name: "x", subject: "", body: "y" })).toThrow();
  });
});

describe("nextVersion", () => {
  it("is one above the highest saved version, 1 for a new template", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1, 3, 2])).toBe(4);
  });
});

describe("restorePatch", () => {
  const versions = [
    { version: 1, name: "A", service_key: null, subject: "S1", body: "B1", follow_up_1: "", follow_up_2: "" },
    { version: 2, name: "A", service_key: null, subject: "S2", body: "B2", follow_up_1: "", follow_up_2: "" },
    { version: 3, name: "A2", service_key: "seo", subject: "S3", body: "B3", follow_up_1: "F", follow_up_2: "" },
  ];
  it("brings back an old version's content, to be saved as the next version", () => {
    expect(restorePatch(versions, 1)).toEqual({
      input: { name: "A", service_key: null, subject: "S1", body: "B1", follow_up_1: "", follow_up_2: "" },
      note: "restored from version 1",
    });
  });
  it("is null for a version that doesn't exist", () => {
    expect(restorePatch(versions, 9)).toBeNull();
  });
});
