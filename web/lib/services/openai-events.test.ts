import { describe, it, expect } from "vitest";
import { eventsPrompt, parseEvents } from "./openai-events";

describe("eventsPrompt", () => {
  it("names the place, year and category", () => {
    const p = eventsPrompt({ country: "mt", category: "iGaming", year: 2026, max: 10 });
    expect(p).toContain("up to 10 conferences");
    expect(p).toContain("in Malta held in 2026");
    expect(p).toContain("Category: iGaming");
    expect(eventsPrompt({ country: "eu", category: "any", year: 2026, max: 5 })).toContain("in Europe held in 2026");
    expect(eventsPrompt({ country: "eu", category: "any", year: 2026, max: 5 })).toContain("Category: any industry");
  });
});

describe("parseEvents", () => {
  const body = (json: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text: json }] }] });
  it("keeps real URLs and dates, drops duplicates and junk", () => {
    const events = parseEvents(
      body(
        JSON.stringify({
          events: [
            { name: "SiGMA Europe 2026", website: "https://sigma.world", exhibitors_url: "sigma.world/x", floor_plan_url: "https://sigma-europe.expofp.com", city: "Valletta", country: "MT", start_date: "2026-11-02", end_date: "bad" },
            { name: "sigma europe 2026", website: null },
            { name: "", website: "https://x" },
          ],
        }),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ name: "SiGMA Europe 2026", website: "https://sigma.world", exhibitors_url: null, floor_plan_url: "https://sigma-europe.expofp.com", city: "Valletta", country: "mt", start_date: "2026-11-02", end_date: null });
  });
  it("returns [] on a non-JSON answer", () => {
    expect(parseEvents(body("nope"))).toEqual([]);
    expect(parseEvents({})).toEqual([]);
  });
});
