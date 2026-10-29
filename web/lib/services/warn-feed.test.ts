/**
 * warn-feed.test.ts — Tests for the WARN Feed service (closure/layoff notices as leads).
 *
 * Inputs:  fixtures in __fixtures__/warn-tx.csv + warn-sample.ndjson, fetch mocked via vi.stubGlobal
 * Outputs: pass/fail
 * Used by: vitest (npm test)
 *
 * Fixture provenance: warn-tx.csv = 13 real TX rows pulled live from the WARN Feed on 2026-10-29.
 * TX publishes NO notice_type (always empty), so the `notice_type` column of these rows (and the
 * headcount of two rows: Conifer blanked = unknown, Postal Center set to 4) was edited by hand to
 * cover closure / layoff / unknown-headcount / small cases. warn-sample.ndjson = first 5 lines of
 * the live archive (2026-10-29), unedited.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WARN_BASE,
  WarnFeedError,
  fetchWarnNotices,
  inWindow,
  isClosure,
  toNormalizedLead,
  type WarnNotice,
} from "./warn-feed";

const fx = (n: string) => readFileSync(path.join(__dirname, "__fixtures__", n), "utf8");
const NOW = new Date("2026-10-29T12:00:00Z");

const closure: WarnNotice = {
  id: "15141d5eaa32788f",
  state: "TX",
  company: "CTI Foods Bean, LLC",
  company_canonical: "CTI Foods Bean",
  company_dba: "",
  location: "Saginaw, Tarrant",
  employees_affected: 66,
  notice_date: "2026-08-27",
  effective_date: "2026-11-09",
  notice_type: "Plant Closing",
  first_seen: "2026-09-07T12:40:44.202978Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("isClosure", () => {
  it("detects closures", () => {
    expect(isClosure("Plant Closing")).toBe(true);
    expect(isClosure("Closure Temporary")).toBe(true);
    expect(isClosure("Permanent closure")).toBe(true);
    expect(isClosure("CL")).toBe(true);
  });
  it("does not treat layoffs (even 'Layoff Permanent') or blanks as closures", () => {
    expect(isClosure("Layoff")).toBe(false);
    expect(isClosure("Layoff Permanent")).toBe(false);
    expect(isClosure("Large Layoff - 10 or more workers")).toBe(false);
    expect(isClosure("")).toBe(false);
  });
});

describe("inWindow", () => {
  it("uses effective_date, falling back to notice_date; future dates count", () => {
    expect(inWindow(closure, 90, NOW)).toBe(true);
    expect(inWindow({ ...closure, effective_date: "2026-01-01" }, 90, NOW)).toBe(false);
    expect(inWindow({ ...closure, effective_date: null, notice_date: "2026-10-01" }, 90, NOW)).toBe(true);
    expect(inWindow({ ...closure, effective_date: null, notice_date: null }, 90, NOW)).toBe(false);
  });
});

describe("toNormalizedLead", () => {
  it("maps a closure notice", () => {
    const l = toNormalizedLead(closure);
    expect(l.business_name).toBe("CTI Foods Bean");
    expect(l.address).toBe("Saginaw, Tarrant, TX");
    expect(l.category).toBe("Plant Closing");
    expect(l.business_status).toBe("OPERATIONAL");
    expect(l.has_website).toBe(false);
    expect(l.website_kind).toBe("none");
    expect(l.place_id).toBe("warn:15141d5eaa32788f");
    expect(l.signal).toEqual({
      type: "closure",
      date: "2026-11-09",
      source_url: `${WARN_BASE}/data/by-state/tx.csv`,
      meta: {
        warn_id: "15141d5eaa32788f",
        state: "TX",
        location: "Saginaw, Tarrant",
        notice_type: "Plant Closing",
        notice_date: "2026-08-27",
        employees_affected: 66,
        company_raw: "CTI Foods Bean, LLC",
        company_canonical: "CTI Foods Bean",
      },
    });
  });
  it("prefers dba and tags layoffs", () => {
    const l = toNormalizedLead({ ...closure, company_dba: "Bean Co", notice_type: "Layoff" });
    expect(l.business_name).toBe("Bean Co");
    expect(l.signal?.type).toBe("layoff");
  });
});

function csvOk() {
  return vi.fn(async () => new Response(fx("warn-tx.csv"), { status: 200 }));
}
const base = { state: "TX", windowDays: 90, minEmployees: 10, limit: 50, now: NOW, retryDelayMs: 1 };

describe("fetchWarnNotices (CSV)", () => {
  it("returns in-window closures; keeps unknown headcount, drops small + stale", async () => {
    const f = vi.fn(async (_u: string) => new Response(fx("warn-tx.csv"), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const leads = await fetchWarnNotices({ ...base, signal: "closures" });
    expect(f.mock.calls[0][0]).toBe(`${WARN_BASE}/data/by-state/tx.csv`);
    expect(leads.map((l) => l.business_name)).toEqual([
      "CTI Foods Bean",
      "New Tech Global Staffing",
      "4XH Logistics",
      "Eagles Delivery",
      "Conifer's Health Solutions",
    ]);
    expect(leads.every((l) => l.signal?.type === "closure")).toBe(true);
  });
  it("closures_layoffs adds layoffs", async () => {
    vi.stubGlobal("fetch", csvOk());
    const leads = await fetchWarnNotices({ ...base, signal: "closures_layoffs" });
    expect(leads.map((l) => l.business_name)).toContain("Truist Bank");
    expect(leads).toHaveLength(8);
  });
  it("honours limit", async () => {
    vi.stubGlobal("fetch", csvOk());
    const leads = await fetchWarnNotices({ ...base, signal: "closures", limit: 2 });
    expect(leads).toHaveLength(2);
  });
  it("throws WarnFeedError on 503", async () => {
    const f = vi.fn(async () => new Response("no", { status: 503 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchWarnNotices({ ...base, signal: "closures" })).rejects.toBeInstanceOf(WarnFeedError);
  });
  it("throws WarnFeedError on 404 without retrying", async () => {
    const f = vi.fn(async () => new Response("no", { status: 404 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchWarnNotices({ ...base, signal: "closures" })).rejects.toBeInstanceOf(WarnFeedError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects a non-state code", async () => {
    await expect(fetchWarnNotices({ ...base, state: "../x", signal: "closures" })).rejects.toBeInstanceOf(
      WarnFeedError,
    );
  });
});

describe("fetchWarnNotices (NDJSON, state=US)", () => {
  const cancelled = { fn: vi.fn() };
  function streamResponse(text: string, chunk = 97) {
    const enc = new TextEncoder().encode(text);
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled.fn();
      },
      pull(c) {
        if (i >= enc.length) return c.close();
        c.enqueue(enc.slice(i, i + chunk));
        i += chunk;
      },
    });
    const text_ = vi.fn(() => {
      throw new Error("text() must not be called");
    });
    const json_ = vi.fn(() => {
      throw new Error("json() must not be called");
    });
    return { ok: true, status: 200, body: stream, text: text_, json: json_ };
  }
  const ndNow = new Date("2027-01-01T00:00:00Z");

  it("streams via the reader (never text()/json()) and filters", async () => {
    const res = streamResponse(fx("warn-sample.ndjson"));
    vi.stubGlobal("fetch", vi.fn(async () => res));
    const leads = await fetchWarnNotices({ ...base, state: "US", signal: "closures_layoffs", now: ndNow, windowDays: 365 });
    expect(res.text).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(leads.length).toBeGreaterThan(0);
    expect(leads[0].business_name).toBe("Rugged Liner");
    expect(leads[1].business_name).toBe("General Motors"); // chunk boundaries don't corrupt lines
  });
  it("stops reading once limit is reached", async () => {
    const res = streamResponse(fx("warn-sample.ndjson"), 50);
    cancelled.fn.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => res));
    const leads = await fetchWarnNotices({ ...base, state: "US", signal: "closures_layoffs", now: ndNow, windowDays: 365, limit: 1 });
    expect(leads).toHaveLength(1);
    expect(cancelled.fn).toHaveBeenCalled();
  });
});
