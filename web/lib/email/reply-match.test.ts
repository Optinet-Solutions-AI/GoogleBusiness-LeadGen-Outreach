/**
 * reply-match.test.ts — a reply lands on the lead we actually emailed, even when its address is on several leads.
 *
 * Inputs:  sample replies + outbound history
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { baseSubject, pickReplyLead, type OutboundRef } from "./reply-match";

const GRACE = "acc-grace";
const ETHAN = "acc-ethan";
const out = (lead_id: string, subject: string, email_account_id: string, created_at: string): OutboundRef => ({
  lead_id,
  subject,
  email_account_id,
  created_at,
});

describe("baseSubject", () => {
  it("strips any number of reply / forward prefixes and ignores case and spacing", () => {
    expect(baseSubject("Re: RE: Fwd:  Your website,  Zoom Drain")).toBe("your website, zoom drain");
    expect(baseSubject("AW: Missed calls at Acme")).toBe("missed calls at acme");
    expect(baseSubject(null)).toBe("");
  });
});

describe("pickReplyLead", () => {
  // The QA case: one test inbox on several leads (Triton, Zoom Drain, Truist).
  const history = [
    out("triton", "Missed calls at Triton Innovations", GRACE, "2026-11-16T11:11:00Z"),
    out("zoom", "Missed calls at Zoom Drain", GRACE, "2026-11-18T07:53:00Z"),
    out("zoom", "Your website, Zoom Drain", GRACE, "2026-11-18T14:36:00Z"),
    out("truist", "Remaining inventory at Truist Bank", ETHAN, "2026-11-18T14:42:00Z"),
  ];
  const all = ["triton", "zoom", "truist", "never-emailed"];

  it("matches the lead whose email has the same subject", () => {
    expect(pickReplyLead({ subject: "Re: Missed calls at Zoom Drain", accountId: GRACE }, all, history)).toBe("zoom");
    expect(pickReplyLead({ subject: "Re: Remaining inventory at Truist Bank", accountId: ETHAN }, all, history)).toBe("truist");
  });

  it("falls back to the lead most recently emailed from the mailbox the reply came into", () => {
    expect(pickReplyLead({ subject: "Quick question", accountId: ETHAN }, all, history)).toBe("truist");
    expect(pickReplyLead({ subject: "Quick question", accountId: GRACE }, all, history)).toBe("zoom");
  });

  it("then to the most recently emailed lead, then the first candidate", () => {
    expect(pickReplyLead({ subject: "hello", accountId: "acc-lily" }, all, history)).toBe("truist");
    expect(pickReplyLead({ subject: "hello", accountId: GRACE }, ["a", "b"], [])).toBe("a");
  });

  it("a single candidate is used as is; none gives null", () => {
    expect(pickReplyLead({ subject: "x", accountId: GRACE }, ["only"], history)).toBe("only");
    expect(pickReplyLead({ subject: "x", accountId: GRACE }, [], history)).toBeNull();
  });
});
