import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { setMailboxPaused, type ControlDb } from "./mailbox-control";

/** A db stub that records the update and returns `row` (null = no such mailbox). */
function stub(row: { email: string } | null, error: string | null = null): ControlDb & { patch: Record<string, unknown> | null } {
  const s = {
    patch: null as Record<string, unknown> | null,
    update: async (_id: string, patch: Record<string, unknown>) => {
      s.patch = patch;
      return { data: row, error: error ? { message: error } : null };
    },
  };
  return s;
}

describe("setMailboxPaused", () => {
  it("Resume clears the pause and restarts the health window", async () => {
    const db = stub({ email: "grace@x.com" });
    const r = await setMailboxPaused("G1", false, new Date("2026-12-10T12:00:00Z"), db);
    expect(r).toEqual({ ok: true, email: "grace@x.com" });
    expect(db.patch).toEqual({ status: "active", paused_reason: null, paused_by: null, paused_at: null, resumed_at: "2026-12-10T12:00:00.000Z" });
  });

  it("Pause by hand is marked as yours", async () => {
    const db = stub({ email: "grace@x.com" });
    await setMailboxPaused("G1", true, new Date("2026-12-10T12:00:00Z"), db);
    expect(db.patch).toEqual({ status: "paused", paused_by: "operator", paused_reason: "Paused by you", paused_at: "2026-12-10T12:00:00.000Z" });
  });

  it("an unknown mailbox is 404", async () => {
    expect(await setMailboxPaused("nope", false, new Date(), stub(null))).toEqual({ ok: false, status: 404, message: "Mailbox not found" });
  });

  it("without migration 077 it says so", async () => {
    expect(await setMailboxPaused("G1", false, new Date(), stub(null, 'column "resumed_at" of relation "email_accounts" does not exist'))).toEqual({
      ok: false,
      status: 503,
      message: "Run database update 077 first (mailbox pause).",
    });
  });
});
