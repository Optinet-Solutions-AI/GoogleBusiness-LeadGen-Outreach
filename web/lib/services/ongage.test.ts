/**
 * ongage.test.ts — lock the Ongage send request and its failure handling (fetch is stubbed, nothing sends).
 *
 * Inputs:  a stubbed fetch + a mutable env
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  LOG_LEVEL: "silent",
  ONGAGE_API_BASE: "https://api.ongage.com",
  ONGAGE_API_KEY: "test-key",
  ONGAGE_TRANSACTIONAL_CAMPAIGN_ID: "123",
  ONGAGE_LIST_ID: "",
  ONGAGE_SENDING_CONNECTION_ID: "",
}));
vi.mock("../config", () => ({ env }));

import { isOngageConfigured, sendEmailOngage } from "./ongage";

const sender = { email: "lucas@rateupdigital.com", fromName: "Lucas RateUp" };

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sentRequest(f: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = f.mock.calls[call] as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) };
}

beforeEach(() => {
  env.ONGAGE_API_KEY = "test-key";
  env.ONGAGE_TRANSACTIONAL_CAMPAIGN_ID = "123";
  env.ONGAGE_LIST_ID = "";
  env.ONGAGE_SENDING_CONNECTION_ID = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sendEmailOngage", () => {
  it("posts our own HTML to the transactional send_embed_content method", async () => {
    const f = vi.fn(async () => reply(200, { metadata: { error: false }, payload: {} }));
    vi.stubGlobal("fetch", f);

    const res = await sendEmailOngage("joe@example.com", "Hi Joe", "<p>Hello</p><p>Bye</p>", {}, sender);

    expect(res.success).toBe(true);
    if (res.success) expect(res.messageId).toMatch(/@rateupdigital\.com>$/);
    const { url, init, body } = sentRequest(f);
    expect(url).toBe("https://api.ongage.com/api/transactional/send_embed_content");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(body).toEqual({
      campaign_id: 123,
      recipients: ["joe@example.com"],
      check_global_and_list_suppression: true,
      message: {
        subject: "Hi Joe",
        content_html: "<p>Hello</p><p>Bye</p>",
        content_text: "Hello\n\nBye",
        addresses: {
          from_name: "Lucas RateUp",
          from_address: "lucas@rateupdigital.com",
          reply_address: "lucas@rateupdigital.com",
        },
      },
    });
  });

  it("targets the configured list and sending connection", async () => {
    env.ONGAGE_LIST_ID = "1290755";
    env.ONGAGE_SENDING_CONNECTION_ID = "4321";
    const f = vi.fn(async () => reply(200, { metadata: { error: false }, payload: {} }));
    vi.stubGlobal("fetch", f);

    await sendEmailOngage("joe@example.com", "Hi", "<p>x</p>", {}, sender);

    const { url, body } = sentRequest(f);
    expect(url).toBe("https://api.ongage.com/1290755/api/transactional/send_embed_content");
    expect(body.sending_connection_id).toBe(4321);
  });

  it("links the hosted screenshot at the marker (Ongage takes no attachments)", async () => {
    const f = vi.fn(async () => reply(200, { metadata: { error: false }, payload: {} }));
    vi.stubGlobal("fetch", f);

    await sendEmailOngage(
      "joe@example.com",
      "Hi",
      "<p>Look:</p><!--SCREENSHOT--><p>Thoughts?</p>",
      { screenshotUrl: "https://cdn.example.com/shot.png" },
      sender,
    );

    const { body } = sentRequest(f);
    expect(body.message.content_html).toMatch(/^<p>Look:<\/p><img src="https:\/\/cdn\.example\.com\/shot\.png"[^>]*><p>Thoughts\?<\/p>$/);
    expect(body.message.content_text).toBe("Look:\n\nThoughts?");
  });

  it("returns Ongage's error message on a failed send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(412, { metadata: { error: true }, payload: { code: 412, message: "Invalid from address" } })),
    );

    const res = await sendEmailOngage("joe@example.com", "Hi", "<p>x</p>", {}, sender);

    expect(res).toEqual({ success: false, error: "Ongage 412: Invalid from address" });
  });

  it("treats an error envelope as a failure even on HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { metadata: { error: true }, payload: { message: "No recipients" } })));

    const res = await sendEmailOngage("joe@example.com", "Hi", "<p>x</p>", {}, sender);

    expect(res).toEqual({ success: false, error: "Ongage 200: No recipients" });
  });

  it("retries a rate-limited send, but not a server error (it may have gone out)", async () => {
    vi.useFakeTimers();
    const limited = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { metadata: { error: true }, payload: { message: "Too many requests" } }))
      .mockResolvedValueOnce(reply(200, { metadata: { error: false }, payload: {} }));
    vi.stubGlobal("fetch", limited);
    const pending = sendEmailOngage("joe@example.com", "Hi", "<p>x</p>", {}, sender);
    await vi.runAllTimersAsync();
    expect((await pending).success).toBe(true);
    expect(limited).toHaveBeenCalledTimes(2);

    const broken = vi.fn(async () => reply(500, { metadata: { error: true }, payload: { message: "Oops" } }));
    vi.stubGlobal("fetch", broken);
    const res = await sendEmailOngage("joe@example.com", "Hi", "<p>x</p>", {}, sender);
    expect(res.success).toBe(false);
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("refuses to send without a key or a campaign, and never calls out", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    env.ONGAGE_TRANSACTIONAL_CAMPAIGN_ID = "";

    const res = await sendEmailOngage("joe@example.com", "Hi", "<p>x</p>", {}, sender);

    expect(res.success).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("isOngageConfigured", () => {
  it("needs both the key and a numeric campaign id", () => {
    expect(isOngageConfigured()).toBe(true);
    env.ONGAGE_TRANSACTIONAL_CAMPAIGN_ID = "abc";
    expect(isOngageConfigured()).toBe(false);
    env.ONGAGE_TRANSACTIONAL_CAMPAIGN_ID = "123";
    env.ONGAGE_API_KEY = "";
    expect(isOngageConfigured()).toBe(false);
  });
});
