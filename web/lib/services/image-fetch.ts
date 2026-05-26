/**
 * image-fetch.ts — Download a remote image and return bytes / data URI.
 *
 * Inputs:  HTTP(S) image URL
 * Outputs: { buffer, contentType } or null on any failure
 * Used by: lib/services/logo.ts (persist FB/IG logos before fbcdn URLs expire)
 *
 * Facebook (fbcdn.net) and Instagram (cdninstagram.com) signed image URLs
 * carry an `oe=<unix-hex>` expiry baked into the signature — typically 3-4
 * weeks. Deployed static sites that reference those URLs render a broken
 * image once the timer ticks over. We download once at stage-2 time and
 * inline the bytes as a base64 data URI so the deployed site never depends
 * on the platform CDN. Storage cost: ~10-40 KB per lead, embedded once in
 * the lead row and once in the generated HTML.
 */

import { getLogger } from "../logger";

const log = getLogger("image-fetch");

const MAX_BYTES = 500_000;
const TIMEOUT_MS = 6_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface FetchedImage {
  buffer: Buffer;
  contentType: string;
}

export async function fetchImageBuffer(url: string): Promise<FetchedImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, accept: "image/*" },
    });
    if (!res.ok) {
      log.warn({ url: url.slice(0, 80), status: res.status }, "image_fetch.bad_status");
      return null;
    }
    const cl = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (cl > MAX_BYTES) {
      log.warn({ url: url.slice(0, 80), size: cl }, "image_fetch.too_large");
      return null;
    }
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_BYTES) {
      log.warn({ url: url.slice(0, 80), size: arr.byteLength }, "image_fetch.too_large");
      return null;
    }
    const contentType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    return { buffer: Buffer.from(arr), contentType };
  } catch (err) {
    log.warn({ url: url.slice(0, 80), err: String(err).slice(0, 200) }, "image_fetch.failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Same as fetchImageBuffer but returns a `data:<mime>;base64,...` URI string
 *  that can be dropped straight into an `<img src>` or DB column. */
export async function fetchImageAsDataUri(url: string): Promise<string | null> {
  const img = await fetchImageBuffer(url);
  if (!img) return null;
  return `data:${img.contentType};base64,${img.buffer.toString("base64")}`;
}
