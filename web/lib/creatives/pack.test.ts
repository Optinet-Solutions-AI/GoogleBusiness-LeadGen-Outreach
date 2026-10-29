/**
 * pack.test.ts — unit tests for pack file naming, captions CSV quoting and zip building.
 *
 * Inputs:  fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { buildPack, captionsCsv, packFileName } from "./pack";

describe("packFileName", () => {
  it("names single and carousel renders", () => {
    expect(packFileName("2026-11-03", "Fall Tune-Up!", "1:1", null)).toBe("2026-11-03_fall-tune-up_1x1.png");
    expect(packFileName("2026-11-03", "Fall Tune-Up!", "9:16", 2)).toBe("2026-11-03_fall-tune-up_9x16_slide-2.png");
  });
  it("caps the title slug at 40 chars without a trailing dash", () => {
    const n = packFileName("2026-11-03", "a".repeat(39) + " bbbbbb", "4:5", null);
    expect(n).toBe(`2026-11-03_${"a".repeat(39)}_4x5.png`);
  });
});

describe("captionsCsv", () => {
  it("quotes commas, quotes and newlines; CRLF endings", () => {
    const csv = captionsCsv([
      { date: "2026-11-03", platform: "instagram", caption: 'Say "hi", friends\nbye', hashtags: ["#a", "#b"], files: ["x.png", "y.png"] },
    ]);
    expect(csv).toBe(
      'date,platform,caption,hashtags,files\r\n2026-11-03,instagram,"Say ""hi"", friends\nbye",#a #b,x.png; y.png\r\n',
    );
  });
});

describe("buildPack", () => {
  it("zips entries under their names", async () => {
    const buf = await buildPack([
      { name: "a.png", data: Buffer.from([1, 2, 3]) },
      { name: "captions.csv", data: "h\r\n" },
    ]);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(["a.png", "captions.csv"]);
    expect([...(await zip.file("a.png")!.async("uint8array"))]).toEqual([1, 2, 3]);
    expect(await zip.file("captions.csv")!.async("string")).toBe("h\r\n");
  });
});
