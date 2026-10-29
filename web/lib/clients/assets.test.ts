/**
 * assets.test.ts — pure helper tests for brand asset copying.
 *
 * Inputs:  hand-built byte arrays and option objects
 * Outputs: vitest assertions
 * Used by: vitest
 */
import { describe, expect, it } from "vitest";
import { extFor, imageSize, isCopyableImage } from "./assets";

const ok = { url: "https://x.com/a.jpg", contentType: "image/jpeg", width: 800, height: 600, forLogo: false };

describe("isCopyableImage", () => {
  it("accepts a large raster image", () => expect(isCopyableImage(ok)).toBe(true));
  it("rejects data: URLs", () => expect(isCopyableImage({ ...ok, url: "data:image/png;base64,AA" })).toBe(false));
  it("rejects non-image and gif", () => {
    expect(isCopyableImage({ ...ok, contentType: "text/html" })).toBe(false);
    expect(isCopyableImage({ ...ok, contentType: null })).toBe(false);
    expect(isCopyableImage({ ...ok, contentType: "image/gif" })).toBe(false);
  });
  it("rejects <200px unless logo", () => {
    expect(isCopyableImage({ ...ok, width: 150 })).toBe(false);
    expect(isCopyableImage({ ...ok, height: 199 })).toBe(false);
    expect(isCopyableImage({ ...ok, width: 150, forLogo: true })).toBe(true);
  });
  it("allows svg only for logos", () => {
    const svg = { ...ok, contentType: "image/svg+xml", width: null, height: null };
    expect(isCopyableImage(svg)).toBe(false);
    expect(isCopyableImage({ ...svg, forLogo: true })).toBe(true);
  });
});

describe("extFor", () => {
  it("maps content types", () => {
    expect(extFor("image/jpeg")).toBe("jpg");
    expect(extFor("image/png")).toBe("png");
    expect(extFor("image/webp")).toBe("webp");
    expect(extFor("image/svg+xml")).toBe("svg");
    expect(extFor("video/mp4")).toBe("mp4");
    expect(extFor("video/quicktime")).toBe("mov");
    expect(extFor("application/pdf")).toBe("pdf");
    expect(extFor("text/plain")).toBeNull();
  });
});

describe("imageSize", () => {
  it("reads PNG IHDR", () => {
    const b = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(640, 16);
    b.writeUInt32BE(480, 20);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });
  it("reads JPEG SOF0 after another segment", () => {
    const b = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 len 4
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, // h=480 w=640
    ]);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });
  it("reads WebP VP8X, VP8L and VP8", () => {
    const base = (fourcc: string) => {
      const b = Buffer.alloc(40);
      b.write("RIFF", 0); b.write("WEBP", 8); b.write(fourcc, 12);
      return b;
    };
    const x = base("VP8X");
    x.writeUIntLE(1000 - 1, 24, 3); x.writeUIntLE(500 - 1, 27, 3);
    expect(imageSize(x)).toEqual({ width: 1000, height: 500 });
    const l = base("VP8L");
    l[20] = 0x2f;
    l.writeUInt32LE((799 | (599 << 14)) >>> 0, 21);
    expect(imageSize(l)).toEqual({ width: 800, height: 600 });
    const v = base("VP8 ");
    Buffer.from([0x9d, 0x01, 0x2a]).copy(v, 23);
    v.writeUInt16LE(320, 26);
    v.writeUInt16LE(240, 28);
    expect(imageSize(v)).toEqual({ width: 320, height: 240 });
  });
  it("returns null for junk", () => {
    expect(imageSize(Buffer.from("<svg></svg>"))).toBeNull();
  });
});
