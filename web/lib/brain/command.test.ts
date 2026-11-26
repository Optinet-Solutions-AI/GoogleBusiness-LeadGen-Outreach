import { describe, expect, it } from "vitest";
import { buildQuestions, matchBatch, parseAsk, WHAT_I_CAN_DO, type Ask } from "./command";
import { jobEstimate } from "./rules";

const ask = (over: Partial<Ask> = {}): Ask => ({ intent: "find_and_work", niche: "plumbers", place: "Texas", countryCode: "us", count: 100, batchHint: null, missing: null, ...over });

describe("parseAsk", () => {
  it("reads a find-and-work command", () => {
    expect(parseAsk({ intent: "find_and_work", niche: " Plumbers ", place: "Texas", country_code: "US", count: 100, batch_hint: "", missing: "" })).toEqual(ask({ niche: "Plumbers" }));
  });

  it("caps the count at 300 and never goes below 1", () => {
    expect(parseAsk({ intent: "find_and_work", niche: "dentists", place: "Austin, TX", country_code: "us", count: 10000, batch_hint: "", missing: "" }).count).toBe(300);
    expect(parseAsk({ intent: "find_and_work", niche: "dentists", place: "Austin, TX", country_code: "us", count: 0, batch_hint: "", missing: "" }).count).toBeNull();
  });

  it("keeps what is missing, so the job can ask for it", () => {
    const a = parseAsk({ intent: "find_and_work", niche: "plumbers", place: "", country_code: "", count: 50, batch_hint: "", missing: "Which city or state?" });
    expect(a).toMatchObject({ place: null, countryCode: null, missing: "Which city or state?" });
  });

  it("says what is missing itself when the AI forgot to", () => {
    expect(parseAsk({ intent: "find_and_work", niche: "", place: "Texas", country_code: "us", count: 50, batch_hint: "", missing: "" }).missing).toBe("What kind of business should I look for?");
    expect(parseAsk({ intent: "find_and_work", niche: "plumbers", place: "", country_code: "us", count: 50, batch_hint: "", missing: "" }).missing).toBe("Which city or state should I search in?");
    expect(parseAsk({ intent: "find_and_work", niche: "plumbers", place: "Texas", country_code: "us", count: 0, batch_hint: "", missing: "" }).missing).toBe("How many leads do you want (up to 300)?");
  });

  it("treats anything it doesn't know as 'other'", () => {
    for (const raw of [null, "hello", {}, { intent: "delete_everything" }]) expect(parseAsk(raw).intent).toBe("other");
    expect(WHAT_I_CAN_DO).toMatch(/Get me 100 plumbers in Texas/);
  });
});

describe("buildQuestions", () => {
  const est = jobEstimate({ searchUsd: 0.96, leads: 100, formLeads: 110 }); // 0.96 + 1 + 11 = 12.96

  it("preselects the smallest budget that covers the estimate, and the operator's defaults", () => {
    const q = buildQuestions({ ask: ask(), estimate: est, callsAvailable: true, isEuPlace: false });
    const budget = q.find((x) => x.key === "budget")!;
    expect(budget.value).toBe(20);
    expect(budget.options!.map((o) => o.value)).toEqual(["10", "20", "50", "other"]);
    expect(q.find((x) => x.key === "channels")!.value).toEqual({ email: true, form: true, call: true });
    expect(q.find((x) => x.key === "perDay")!.value).toEqual({ emails: 10, forms: 10, calls: 5 });
    expect(q.find((x) => x.key === "followUps")!.value).toBe(0);
  });

  it("asks about EU/UK only when the job is there", () => {
    expect(buildQuestions({ ask: ask(), estimate: est, callsAvailable: true, isEuPlace: false }).some((x) => x.key === "includeEu")).toBe(false);
    const eu = buildQuestions({ ask: ask({ place: "Berlin", countryCode: "de" }), estimate: est, callsAvailable: true, isEuPlace: true });
    expect(eu.find((x) => x.key === "includeEu")).toMatchObject({ value: false });
  });

  it("switches the AI call off, with the reason, when calling isn't connected", () => {
    const q = buildQuestions({ ask: ask(), estimate: est, callsAvailable: false, isEuPlace: false }).find((x) => x.key === "channels")!;
    expect(q.value).toEqual({ email: true, form: true, call: false });
    expect(q.note).toMatch(/AI calls aren't connected/);
  });

  it("offers a bigger budget when even $50 doesn't cover the estimate", () => {
    const big = jobEstimate({ searchUsd: 3, leads: 300, formLeads: 600 }); // 66
    expect(buildQuestions({ ask: ask(), estimate: big, callsAvailable: true, isEuPlace: false }).find((x) => x.key === "budget")!.value).toBe(66);
  });
});

describe("matchBatch", () => {
  const batches = [
    { id: "B1", niche: "dentists", city: "Austin, TX", status: "done" },
    { id: "B2", niche: "plumbers", city: "Austin, TX", status: "done" },
    { id: "B3", niche: "dentists", city: "Dallas, TX", status: "running" },
  ];

  it("finds the one finished batch the words describe", () => {
    expect(matchBatch("the Austin dentists batch", batches)).toEqual({ id: "B1" });
  });

  it("never matches a batch that isn't finished", () => {
    expect(matchBatch("dallas dentists", batches)).toEqual({ candidates: [{ id: "B1", label: "dentists · Austin, TX" }, { id: "B2", label: "plumbers · Austin, TX" }] });
  });

  it("offers a list when the words fit more than one, or none", () => {
    expect(matchBatch("austin", batches)).toEqual({ candidates: [{ id: "B1", label: "dentists · Austin, TX" }, { id: "B2", label: "plumbers · Austin, TX" }] });
    expect(matchBatch(null, batches)).toMatchObject({ candidates: expect.any(Array) });
  });
});
