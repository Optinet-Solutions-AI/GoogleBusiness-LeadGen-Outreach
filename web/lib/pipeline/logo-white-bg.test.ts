/**
 * logo-white-bg.test.ts — locks white-background removal for raster logos.
 * Edge flood-fill must clear a solid white background but preserve white that
 * lives INSIDE the mark (not connected to the border).
 */
import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { removeWhiteBackground } from "./html-template-render";

function makePng(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

describe("removeWhiteBackground", () => {
  it("clears a solid white background, keeps the dark mark", () => {
    // 40x40 white field with a dark 12x12 block in the center.
    const buf = makePng(40, 40, (x, y) => {
      const inMark = x >= 14 && x < 26 && y >= 14 && y < 26;
      return inMark ? [20, 20, 20, 255] : [255, 255, 255, 255];
    });
    const out = removeWhiteBackground(buf);
    expect(out).not.toBeNull();
    const png = PNG.sync.read(out!);
    const at = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
    expect(at(0, 0)).toBe(0);     // corner background cleared
    expect(at(20, 20)).toBe(255); // mark center preserved (opaque)
  });

  it("preserves white INSIDE the mark (not edge-connected)", () => {
    // dark ring with a white hole in the middle — the hole must stay opaque.
    const buf = makePng(40, 40, (x, y) => {
      const dx = x - 20, dy = y - 20, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 6) return [255, 255, 255, 255];   // inner white hole
      if (d < 12) return [20, 20, 20, 255];      // dark ring
      return [255, 255, 255, 255];                // white background
    });
    const out = removeWhiteBackground(buf);
    expect(out).not.toBeNull();
    const png = PNG.sync.read(out!);
    const at = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
    expect(at(0, 0)).toBe(0);     // background cleared
    expect(at(20, 20)).toBe(255); // interior white hole preserved
  });

  it("returns null when there is no white background to remove", () => {
    const buf = makePng(40, 40, () => [30, 80, 160, 255]); // all blue
    expect(removeWhiteBackground(buf)).toBeNull();
  });
});
