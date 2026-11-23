/**
 * email-used.test.ts — what we record about the email a Send email used (scoreboard + wording tests, 24 Nov 2026).
 *
 * Inputs:  what the window says it used, fake template / test lookups
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("@/lib/email/template-library", () => ({ getTemplate: vi.fn() }));
vi.mock("@/lib/email/email-tests", () => ({ getTest: vi.fn() }));

import { resolveEmailUsed, type UsedDeps } from "./email-used";

const RUNNING = { id: "t1", service_key: "seo", a_key: "service:seo", b_key: "saved:b1", a_label: "A", b_label: "B", status: "running" as const, winner: null, started_at: "2026-11-24T00:00:00Z", ended_at: null };
function deps(over: Partial<UsedDeps> = {}): UsedDeps {
  return {
    template: vi.fn(async (id: string) => (id === "b1" ? { name: "SEO short", version: 3 } : null)),
    test: vi.fn(async (id: string) => (id === "t1" ? RUNNING : null)),
    ...over,
  };
}

describe("resolveEmailUsed", () => {
  it("a ready-made email gets the offer's name", async () =>
    expect(await resolveEmailUsed({ key: "service:seo", edited: true }, deps())).toEqual({ key: "service:seo", label: "SEO (show up higher on Google)", edited: true }));
  it("a saved template gets its name and version", async () =>
    expect(await resolveEmailUsed({ key: "saved:b1", edited: false }, deps())).toEqual({ key: "saved:b1", label: "SEO short (v3)", version: 3, edited: false }));
  it("a saved template that's gone still counts, under a plain name", async () =>
    expect(await resolveEmailUsed({ key: "saved:zzz", edited: false }, deps())).toMatchObject({ key: "saved:zzz", label: "A saved template" }));
  it("an unknown kind of key isn't recorded", async () => {
    expect(await resolveEmailUsed({ key: "whatever", edited: false }, deps())).toBeNull();
    expect(await resolveEmailUsed({ key: "service:not_an_offer", edited: false }, deps())).toBeNull();
  });
  it("keeps the wording test when the email is that test's version", async () =>
    expect(await resolveEmailUsed({ key: "saved:b1", edited: false, testId: "t1", variant: "B" }, deps())).toMatchObject({ test_id: "t1", variant: "B" }));
  it("drops the test when it doesn't match (wrong version, ended, unknown)", async () => {
    expect(await resolveEmailUsed({ key: "saved:b1", edited: false, testId: "t1", variant: "A" }, deps())).not.toHaveProperty("test_id");
    expect(await resolveEmailUsed({ key: "service:seo", edited: false, testId: "nope", variant: "A" }, deps())).not.toHaveProperty("test_id");
    const ended = deps({ test: vi.fn(async () => ({ ...RUNNING, status: "done" as const, winner: "A" as const })) });
    expect(await resolveEmailUsed({ key: "service:seo", edited: false, testId: "t1", variant: "A" }, ended)).not.toHaveProperty("test_id");
  });
});
