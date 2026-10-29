/**
 * assets.test.ts — pure helper tests for brand asset copying.
 *
 * Inputs:  hand-built byte arrays and option objects
 * Outputs: vitest assertions
 * Used by: vitest
 */
import { describe, expect, it } from "vitest";
import {
  checkUploadLimits,
  excludeRenders,
  extFor,
  imageSize,
  isCopyableImage,
  kindForContentType,
  renderPath,
  newRenderRevision,
  RENDER_CACHE_SECONDS,
  UPLOAD_LIMITS,
} from "./assets";

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

describe("kindForContentType", () => {
  it("maps allowed upload types", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) expect(kindForContentType(t)).toBe("photo");
    for (const t of ["video/mp4", "video/quicktime"]) expect(kindForContentType(t)).toBe("video");
    expect(kindForContentType("application/pdf")).toBe("document");
  });
  it("rejects svg, gif and text", () => {
    for (const t of ["image/svg+xml", "image/gif", "text/plain"]) expect(kindForContentType(t)).toBeNull();
  });
});

describe("checkUploadLimits", () => {
  it("allows up to the limit and refuses above, naming it", () => {
    expect(checkUploadLimits("photo", UPLOAD_LIMITS.image)).toBeNull();
    expect(checkUploadLimits("photo", UPLOAD_LIMITS.image + 1)).toBe("Images must be 15 MB or smaller");
    expect(checkUploadLimits("logo", UPLOAD_LIMITS.image + 1)).toBe("Images must be 15 MB or smaller");
    expect(checkUploadLimits("video", UPLOAD_LIMITS.video)).toBeNull();
    expect(checkUploadLimits("video", UPLOAD_LIMITS.video + 1)).toBe("Videos must be 100 MB or smaller");
    expect(checkUploadLimits("document", UPLOAD_LIMITS.document)).toBeNull();
    expect(checkUploadLimits("document", UPLOAD_LIMITS.document + 1)).toBe("Documents must be 20 MB or smaller");
  });
  it("refuses empty files", () => {
    expect(checkUploadLimits("photo", 0)).toBe("File is empty");
  });
});

describe("renderPath", () => {
  it("maps aspect colons to x", () => {
    expect(renderPath("c1", "v1", "1:1", null)).toBe("c1/creatives/v1/1x1.png");
    expect(renderPath("c1", "v1", "4:5", null)).toBe("c1/creatives/v1/4x5.png");
    expect(renderPath("c1", "v1", "9:16", 2)).toBe("c1/creatives/v1/9x16-slide-2.png");
  });
  it("puts every render run under a new revision segment (Ruling 34: never a cached URL)", () => {
    expect(renderPath("c1", "v1", "1:1", null, "1793255404591")).toBe("c1/creatives/v1/r1793255404591/1x1.png");
    expect(renderPath("c1", "v1", "9:16", 3, "7")).toBe("c1/creatives/v1/r7/9x16-slide-3.png");
    const a = newRenderRevision(1000);
    const b = newRenderRevision(1001);
    expect(renderPath("c1", "v1", "4:5", null, a)).not.toBe(renderPath("c1", "v1", "4:5", null, b));
    expect(RENDER_CACHE_SECONDS).toBeLessThanOrEqual(60);
  });
});

describe("excludeRenders", () => {
  it("drops origin=render rows only", () => {
    const rows = [{ origin: "upload" }, { origin: "render" }, { origin: "website" }];
    expect(excludeRenders(rows)).toEqual([{ origin: "upload" }, { origin: "website" }]);
  });
});
