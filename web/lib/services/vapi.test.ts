/**
 * vapi.test.ts — the read-only Vapi client: no key = off, wrong account = no_access, https-only downloads.
 *
 * Inputs:  stubbed fetch + env
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => ({ env: { VAPI_API_KEY: "k" } }));
vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../config", () => ({ env }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { downloadAudio, getVapiCall, isVapiConfigured } from "./vapi";

const fetchMock = vi.fn();
beforeEach(() => {
  env.VAPI_API_KEY = "k";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("vapi", () => {
  it("is off without a key and never calls Vapi", async () => {
    env.VAPI_API_KEY = "";
    expect(isVapiConfigured()).toBe(false);
    expect(await getVapiCall("c1")).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a call the key can't see is no_access", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await getVapiCall("c1")).toEqual({ ok: false, code: "no_access", status: 404 });
  });

  it("returns the call", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c1", artifact: {} }), { status: 200 }));
    expect(await getVapiCall("c1")).toEqual({ ok: true, data: { id: "c1", artifact: {} } });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.vapi.ai/call/c1");
  });

  it("refuses a non-https recording link without fetching", async () => {
    expect((await downloadAudio("http://x/a.wav")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads audio bytes with the content type", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/wav" } }));
    const r = await downloadAudio("https://x/a.wav");
    expect(r.ok && r.contentType).toBe("audio/wav");
    expect(r.ok && r.bytes.byteLength).toBe(3);
  });
});
