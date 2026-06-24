/**
 * logo-trim.ts — Trim transparent padding off a PNG logo.
 *
 * Inputs:  PNG image bytes
 * Outputs: cropped PNG bytes (mark fills the frame), or null when not worth it
 * Used by: lib/services/logo.ts — before inlining a fetched logo as a data URI
 *
 * Many logos ship as a small mark centered in a big transparent square (e.g. a
 * 1024x1024 PNG with the wordmark in the middle). Rendered at a fixed nav
 * height, the visible mark looks tiny. We crop to the non-transparent bounding
 * box so the actual logo fills the space. Pure JS (pngjs) — no native binary.
 * Never throws; returns null to mean "keep the original".
 */

import { PNG } from "pngjs";
import { getLogger } from "../logger";

const log = getLogger("logo-trim");
const ALPHA_THRESHOLD = 16; // treat near-transparent pixels as empty

export function trimTransparentPadding(buf: Buffer): Buffer | null {
  let png: PNG;
  try {
    png = PNG.sync.read(buf);
  } catch {
    return null; // not a decodable PNG — leave it alone
  }
  const { width, height, data } = png;
  if (width < 8 || height < 8) return null;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Fully transparent, or has an opaque (non-transparent) background we can't
  // crop — bbox spans (nearly) the whole image. Keep the original.
  if (maxX < 0) return null;
  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  if (contentW >= width * 0.92 && contentH >= height * 0.92) return null;

  // Small breathing-room margin around the mark (4% of the content size).
  const margin = Math.round(Math.max(contentW, contentH) * 0.04);
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(width - 1, maxX + margin);
  maxY = Math.min(height - 1, maxY + margin);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((minY + y) * width + (minX + x)) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  try {
    const cropped = PNG.sync.write(out);
    log.info({ from: `${width}x${height}`, to: `${w}x${h}` }, "logo_trim.cropped");
    return cropped;
  } catch {
    return null;
  }
}
