import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { NotFoundError, VersionConflictError } from "@/lib/clients/profile";
import { ReviewError } from "./creatives";
import { CreativeBusyError } from "./generate";
import { PlanStateError } from "./plans";
import { allUuids, mapCreativeError } from "./http-errors";

describe("mapCreativeError", () => {
  it.each([
    [new NotFoundError("nope"), 404],
    [new PlanStateError("busy"), 409],
    [new ReviewError("no renders"), 422],
    [new VersionConflictError(), 409],
    [new CreativeBusyError(), 409],
  ])("maps %o to %i", (err, status) => {
    expect(mapCreativeError(err).status).toBe(status);
  });

  it("maps a ZodError to 400 with the first issue path", async () => {
    const r = z.object({ a: z.number() }).safeParse({ a: "x" });
    if (r.success) throw new Error("unreachable");
    const res = mapCreativeError(r.error);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^a: /);
  });

  it("rethrows unknown errors", () => {
    expect(() => mapCreativeError(new Error("boom"))).toThrow("boom");
  });
});

describe("allUuids", () => {
  it("validates uuids", () => {
    expect(allUuids("9d587077-6712-4bf8-a46b-df6d4e17a8d2")).toBe(true);
    expect(allUuids("9d587077-6712-4bf8-a46b-df6d4e17a8d2", "x")).toBe(false);
  });
});
