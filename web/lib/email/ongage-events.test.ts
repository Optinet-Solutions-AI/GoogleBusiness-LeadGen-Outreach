/**
 * ongage-events.test.ts — Ongage bounce / unsubscribe / complaint reports reach the right leads, once.
 *
 * Inputs:  sample webhook bodies + fake deps
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no db in tests"); } }));

import { actionFor, applyOngageEvents, exactILike, parseOngagePayload, type OngageDeps } from "./ongage-events";

describe("parseOngagePayload", () => {
  it("reads the documented array, lower-cases the address and drops junk", () => {
    const evs = parseOngagePayload([
      { email: "Joe@Acme.com ", list_id: 9998, status: "hard", esp_name: "Amazon SES" },
      { email: "x@y.com", status: "opened" },
      { status: "soft" },
      { email: "a@b.com", list_id: 1, status: "Complaint" },
    ]);
    expect(evs).toEqual([
      { email: "joe@acme.com", status: "hard", listId: "9998", esp: "Amazon SES" },
      { email: "a@b.com", status: "complaint", listId: "1", esp: null },
    ]);
  });
  it("accepts a single object or a wrapped list, and nothing at all", () => {
    expect(parseOngagePayload({ email: "a@b.com", status: "unsubscribe" })).toHaveLength(1);
    expect(parseOngagePayload({ data: [{ email: "a@b.com", status: "soft" }] })).toHaveLength(1);
    expect(parseOngagePayload(null)).toEqual([]);
  });
});

describe("actionFor", () => {
  it("hard bounce marks the address bad; unsubscribe and complaint suppress the lead", () => {
    expect(actionFor("hard")).toMatchObject({ kind: "email_bounced", bounceKind: "hard", leadPatch: { verification_status: "invalid" } });
    expect(actionFor("soft")).toMatchObject({ kind: "email_bounced", bounceKind: "soft", leadPatch: {} });
    expect(actionFor("unsubscribe").leadPatch).toEqual({ lifecycle_stage: "unsubscribed" });
    expect(actionFor("complaint")).toMatchObject({ kind: "email_complaint", leadPatch: { lifecycle_stage: "dnc" } });
  });
});

function deps(over: Partial<OngageDeps> = {}): OngageDeps {
  return {
    emailedLeads: vi.fn(async (e: string) => (e === "joe@acme.com" ? ["L1"] : [])),
    alreadyRecorded: vi.fn(async () => false),
    record: vi.fn(async () => undefined),
    patchLead: vi.fn(async () => undefined),
    stopSequence: vi.fn(async () => undefined),
    ...over,
  };
}

describe("applyOngageEvents", () => {
  it("records a hard bounce, marks the address invalid and stops the sequence", async () => {
    const d = deps();
    const r = await applyOngageEvents([{ email: "joe@acme.com", status: "hard", listId: "9", esp: "SES" }], d);
    expect(r).toEqual({ received: 1, applied: 1, ignored: 0 });
    expect(d.record).toHaveBeenCalledWith("L1", "email_bounced", expect.objectContaining({ source: "ongage", bounceKind: "hard" }));
    expect(d.patchLead).toHaveBeenCalledWith("L1", { verification_status: "invalid" });
    expect(d.stopSequence).toHaveBeenCalledWith("L1");
  });
  it("ignores addresses we never emailed (the Ongage account is shared with other projects)", async () => {
    const d = deps();
    const r = await applyOngageEvents([{ email: "someone@else.com", status: "unsubscribe", listId: null, esp: null }], d);
    expect(r).toEqual({ received: 1, applied: 0, ignored: 1 });
    expect(d.record).not.toHaveBeenCalled();
  });
  it("records a retried report only once", async () => {
    const d = deps({ alreadyRecorded: vi.fn(async () => true) });
    const r = await applyOngageEvents([{ email: "joe@acme.com", status: "complaint", listId: null, esp: null }], d);
    expect(r.applied).toBe(0);
    expect(d.patchLead).not.toHaveBeenCalled();
  });
  it("a soft bounce stops the sequence without condemning the address", async () => {
    const d = deps();
    await applyOngageEvents([{ email: "joe@acme.com", status: "soft", listId: null, esp: null }], d);
    expect(d.patchLead).not.toHaveBeenCalled();
    expect(d.stopSequence).toHaveBeenCalledWith("L1");
  });
});

describe("exactILike", () => {
  it("escapes LIKE wildcards so an underscore in an address isn't a wildcard", () => {
    expect(exactILike("first_last@acme.com")).toBe("first\\_last@acme.com");
    expect(exactILike("100%@x.com")).toBe("100\\%@x.com");
  });
});
