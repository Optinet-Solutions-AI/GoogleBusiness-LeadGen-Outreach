/**
 * recording-capture.test.ts — copying one AI call's recording from Vapi into our private bucket.
 *
 * Inputs:  a fake Supabase client + a mocked Vapi client
 * Outputs: vitest assertions (what is uploaded / written, and that nothing throws)
 * Used by: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const updates: { patch: Record<string, unknown>; id: string }[] = [];
  const uploads: { bucket: string; path: string; opts: Record<string, unknown> }[] = [];
  const db = {
    storage: {
      createBucket: vi.fn(async () => ({ error: null })),
      from: (bucket: string) => ({
        upload: async (path: string, _b: unknown, opts: Record<string, unknown>) => {
          uploads.push({ bucket, path, opts });
          return { error: null };
        },
      }),
    },
    sweepRows: [] as Record<string, unknown>[],
    from: () => ({
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["eq", "is", "not", "or", "gte", "order"]) chain[m] = () => chain;
        chain.limit = async () => ({ data: db.sweepRows, error: null });
        return chain;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          updates.push({ patch, id });
          return { error: null };
        },
      }),
    }),
  };
  return {
    updates,
    uploads,
    db,
    vapi: { isVapiConfigured: vi.fn(() => true), getVapiCall: vi.fn(), downloadAudio: vi.fn() },
  };
});

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("@/lib/services/vapi", () => h.vapi);

import { captureRecording, RECORDINGS_BUCKET, sweepRecordings } from "./recording-capture";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const attempt = (endedMinutesAgo: number) => ({
  id: "a1",
  meta: { vapi_call_id: "v1", phone: "+15125550100", agent_name: null },
  ended_at: minutesAgo(endedMinutesAgo),
  created_at: minutesAgo(endedMinutesAgo + 2),
});

beforeEach(() => {
  h.updates.length = 0;
  h.uploads.length = 0;
  h.vapi.isVapiConfigured.mockReturnValue(true);
  h.vapi.getVapiCall.mockReset();
  h.vapi.downloadAudio.mockReset();
});

describe("captureRecording", () => {
  it("copies the recording into the private bucket and keeps the other meta", async () => {
    h.vapi.getVapiCall.mockResolvedValue({ ok: true, data: { artifact: { presignedMonoUrl: "https://r/x" } } });
    h.vapi.downloadAudio.mockResolvedValue({ ok: true, bytes: new ArrayBuffer(4), contentType: "audio/mpeg" });
    expect(await captureRecording(attempt(30))).toBe("copied");
    expect(h.uploads).toEqual([{ bucket: RECORDINGS_BUCKET, path: "a1.mp3", opts: expect.objectContaining({ upsert: true, contentType: "audio/mpeg" }) }]);
    expect(h.db.storage.createBucket).toHaveBeenCalledWith("call-recordings", { public: false });
    expect(h.updates[0]).toEqual({ id: "a1", patch: { recording_url: "a1.mp3", meta: { vapi_call_id: "v1", phone: "+15125550100", agent_name: null, recording_state: "copied" } } });
  });

  it("a key that can't see the call is saved as no_access, nothing uploaded", async () => {
    h.vapi.getVapiCall.mockResolvedValue({ ok: false, code: "no_access", status: 404 });
    expect(await captureRecording(attempt(30))).toBe("no_access");
    expect(h.uploads).toHaveLength(0);
    expect(h.updates[0].patch.meta).toMatchObject({ recording_state: "no_access" });
  });

  it("no link yet, 30 min after the call: waits and writes nothing", async () => {
    h.vapi.getVapiCall.mockResolvedValue({ ok: true, data: { artifact: {} } });
    expect(await captureRecording(attempt(30))).toBe("wait");
    expect(h.updates).toHaveLength(0);
  });

  it("is off without a key: Vapi is never asked", async () => {
    h.vapi.isVapiConfigured.mockReturnValue(false);
    expect(await captureRecording(attempt(30))).toBe("off");
    expect(h.vapi.getVapiCall).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    h.vapi.getVapiCall.mockRejectedValue(new Error("boom"));
    expect(await captureRecording(attempt(30))).toBe("error");
  });

  it("older than 13 days: marked lost without asking Vapi", async () => {
    expect(await captureRecording(attempt(14 * 24 * 60))).toBe("lost");
    expect(h.vapi.getVapiCall).not.toHaveBeenCalled();
    expect(h.updates[0].patch.meta).toMatchObject({ recording_state: "lost" });
  });
});

describe("sweepRecordings", () => {
  it("stops at the first sign Vapi is down, instead of trying every row", async () => {
    h.db.sweepRows = [attempt(30), { ...attempt(40), id: "a2" }, { ...attempt(50), id: "a3" }];
    h.vapi.getVapiCall.mockResolvedValue({ ok: false, code: "network_error", status: 0 });
    await sweepRecordings();
    expect(h.vapi.getVapiCall).toHaveBeenCalledTimes(1);
  });

  it("stops when its time budget is used up", async () => {
    h.db.sweepRows = [attempt(30), { ...attempt(40), id: "a2" }];
    h.vapi.getVapiCall.mockResolvedValue({ ok: true, data: { artifact: {} } });
    await sweepRecordings(10, 0);
    expect(h.vapi.getVapiCall).not.toHaveBeenCalled();
  });
});
