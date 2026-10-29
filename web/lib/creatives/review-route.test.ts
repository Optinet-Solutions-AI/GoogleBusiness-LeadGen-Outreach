/**
 * review-route.test.ts — POST /api/clients/:id/creatives/:cid/review refuses approve while the post is rendering
 *                        (Ruling 34). Mocked library calls, no db, no network.
 *
 * Inputs:  a mocked creative (status + latest draft) and a spy reviewVersion
 * Outputs: vitest assertions on the route response
 * Used by: vitest (npm test)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "ready", reviewed: 0 }));

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/safe-db", () => ({ isDbConfigured: () => true }));
vi.mock("@/lib/creatives/http-errors", () => ({
  allUuids: () => true,
  mapCreativeError: (e: unknown) => {
    throw e;
  },
}));
vi.mock("@/lib/creatives/creatives", () => ({
  getCreative: async () => ({ id: "c", status: state.status, versions: [{ version: 2, state: "draft" }] }),
  reviewVersion: async () => {
    state.reviewed++;
    return { version: 2, state: "approved" };
  },
}));

import { POST } from "@/app/api/clients/[id]/creatives/[cid]/review/route";

const call = (action: string) =>
  POST(
    new Request("http://x/api/clients/a/creatives/b/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
    { params: { id: "a", cid: "b" } },
  );

describe("review route", () => {
  beforeEach(() => {
    state.status = "ready";
    state.reviewed = 0;
  });
  it("refuses approve while the creative is rendering (nothing is reviewed)", async () => {
    state.status = "rendering";
    const res = await call("approve");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("being rendered");
    expect(state.reviewed).toBe(0);
  });
  it("still allows reject while rendering, and approve once it is ready", async () => {
    state.status = "rendering";
    expect((await call("reject")).status).toBe(200);
    state.status = "ready";
    expect((await call("approve")).status).toBe(200);
    expect(state.reviewed).toBe(2);
  });
});
