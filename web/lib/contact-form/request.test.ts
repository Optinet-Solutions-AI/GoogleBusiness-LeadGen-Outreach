import { describe, expect, it } from "vitest";
import { contactFormBody } from "./request";

const RUN = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("contactFormBody", () => {
  it("accepts a look", () => expect(contactFormBody.safeParse({ action: "look" }).success).toBe(true));
  it("accepts a forced look", () => expect(contactFormBody.safeParse({ action: "look", force: true }).success).toBe(true));
  it("accepts a full send", () =>
    expect(
      contactFormBody.safeParse({ action: "send", runId: RUN, senderEmail: "grace@rp.rateupdigital.com", subject: "Hi", message: "Hello", offerKey: "seo" })
        .success,
    ).toBe(true));
  it("rejects a send with an empty message", () => {
    const r = contactFormBody.safeParse({ action: "send", runId: RUN, subject: "Hi", message: "   " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Write a message first");
  });
  it("rejects an unknown action", () => expect(contactFormBody.safeParse({ action: "submit" }).success).toBe(false));
});
