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

import { buildPack, captionsCsv, captionsJson, mapLimit, packFileName, packManifest } from "./pack";

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

describe("packManifest", () => {
  const render = (aspect: "1:1" | "4:5", slide: number | null) => ({
    aspect, slide, asset_id: "a", public_url: `https://s/${aspect}-${slide}.png`, width: 1, height: 1,
  });
  const c = {
    id: "c1", slot_date: "2026-12-03", title: "Fall Tune-Up", platforms: ["instagram", "facebook"] as ("instagram" | "facebook")[],
    version: { renders: [render("1:1", null), render("4:5", 2)], copy: { instagram: { caption: "hi", hashtags: ["#a"] } } },
  };
  it("lists files with urls and builds captions rows per platform", () => {
    const m = packManifest("x-2026-12.zip", [c])!;
    expect(m.filename).toBe("x-2026-12.zip");
    expect(m.files.map((f) => f.name)).toEqual(["2026-12-03_fall-tune-up_1x1.png", "2026-12-03_fall-tune-up_4x5_slide-2.png"]);
    expect(m.files[1]).toMatchObject({ url: "https://s/4:5-2.png", creative_id: "c1", aspect: "4:5", slide: 2 });
    expect(m.captions_csv.trim().split("\r\n")).toHaveLength(3);
  });
  it("carries captions.json: one { date, platform, caption, hashtags, files } per creative and platform (Ruling 35)", () => {
    const m = packManifest("x.zip", [c])!;
    const rows = JSON.parse(m.captions_json) as unknown[];
    expect(rows).toEqual([
      {
        date: "2026-12-03",
        platform: "instagram",
        caption: "hi",
        hashtags: ["#a"],
        files: ["2026-12-03_fall-tune-up_1x1.png", "2026-12-03_fall-tune-up_4x5_slide-2.png"],
      },
      {
        date: "2026-12-03",
        platform: "facebook",
        caption: "",
        hashtags: [],
        files: ["2026-12-03_fall-tune-up_1x1.png", "2026-12-03_fall-tune-up_4x5_slide-2.png"],
      },
    ]);
    expect(captionsJson([])).toBe("[]\n");
  });
  it("returns null with no renders", () => {
    expect(packManifest("x.zip", [])).toBeNull();
  });
});

describe("mapLimit", () => {
  it("bounds concurrency and keeps order", async () => {
    let inflight = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inflight++; peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
