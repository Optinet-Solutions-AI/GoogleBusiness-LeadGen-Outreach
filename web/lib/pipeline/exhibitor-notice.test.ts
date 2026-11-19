/**
 * exhibitor-notice.test.ts — the batch message that says what a conference search found, show by show.
 *
 * Inputs:  ExhibitorRunLog-shaped run logs
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { exhibitorNotice } from "./exhibitor-notice";

const base = { country: "pt", category: "igaming", kept: 0, duplicates: 0 };

describe("exhibitorNotice", () => {
  it("warns when no conference was found, and says what to try", () => {
    const n = exhibitorNotice({ ...base, run: { events: [], discovery_usd: 0.02 } });
    expect(n.level).toBe("warning");
    expect(n.text).toBe(
      "No conferences with an exhibitor list were found for iGaming & betting in Portugal (PT). Try All of Europe or another country, or paste a conference's exhibitor page or ExpoFP floor-plan link in the batch form.",
    );
  });

  it("names Europe for the eu value", () => {
    expect(exhibitorNotice({ ...base, country: "eu", run: { events: [], discovery_usd: 0 } }).text).toMatch(/in Europe\./);
  });

  it("lists each show and why it gave nothing, as a warning when nothing was kept", () => {
    const n = exhibitorNotice({
      ...base,
      run: {
        discovery_usd: 0,
        events: [
          { name: "SiGMA", url: "u", source: "blocked", exhibitors: 0, detail: "x" },
          { name: "ICE", url: "u", source: "empty", exhibitors: 0 },
          { name: "Expo X", url: "u", source: "error", exhibitors: 0 },
          { name: "bad", url: "bad", source: "error", exhibitors: 0, detail: "not a valid link" },
        ],
      },
    });
    expect(n.level).toBe("warning");
    expect(n.text).toBe(
      "Conferences checked (4): SiGMA — the site blocks robots, paste its ExpoFP floor-plan link; ICE — no exhibitor list on its pages yet; Expo X — couldn't open its pages; bad — not a valid link. No companies kept. Paste a conference's exhibitor page or ExpoFP floor-plan link in the batch form to try a specific show.",
    );
  });

  it("is info when companies were kept, with counts per show and duplicates", () => {
    const n = exhibitorNotice({
      ...base,
      kept: 5,
      duplicates: 2,
      run: {
        discovery_usd: 0,
        events: [
          { name: "SiGMA", url: "u", source: "expofp", exhibitors: 120 },
          { name: "ICE", url: "u", source: "page", exhibitors: 40 },
        ],
      },
    });
    expect(n.level).toBe("info");
    expect(n.text).toBe("Conferences checked (2): SiGMA — 120 exhibitors (floor plan); ICE — 40 exhibitors (exhibitor page). 5 companies kept, 2 duplicates left out.");
  });

  it("lists at most 8 shows", () => {
    const events = Array.from({ length: 11 }, (_, i) => ({ name: `Show ${i + 1}`, url: "u", source: "empty" as const, exhibitors: 0 }));
    const n = exhibitorNotice({ ...base, run: { discovery_usd: 0, events } });
    expect(n.text).toMatch(/Show 8 — no exhibitor list on its pages yet; and 3 more\./);
    expect(n.text).not.toMatch(/Show 9/);
  });
});
