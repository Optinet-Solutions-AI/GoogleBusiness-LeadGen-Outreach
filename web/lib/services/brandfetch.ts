/**
 * brandfetch.ts — Logo lookup via Brandfetch (https://developers.brandfetch.com/).
 *
 * Inputs:  domain string (e.g. 'joesplumbing.com')
 * Outputs: best-fit logo URL (PNG/SVG hosted by Brandfetch) or null
 * Used by: lib/services/logo.ts → tried first, falls back to monogram
 *
 * Pricing: free tier = 1,000 lookups/month with an API key (much higher than
 * the unauthenticated CDN endpoint and gets us the structured /v2/brands
 * response). The API key lives in BRANDFETCH_API_KEY; if blank, the function
 * is a no-op so the rest of the pipeline keeps working.
 *
 * Brandfetch returns multiple logo variants per brand (icon vs full logo,
 * light vs dark theme). We pick: prefer dark-theme full logo (best on light
 * backgrounds), fall back to any logo, finally to any icon.
 */

import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("brandfetch");
const BASE_URL = "https://api.brandfetch.io/v2";

interface BrandfetchLogoFormat {
  src?: string;
  format?: string;       // "png" | "svg" | "jpeg" | ...
  background?: string;
  size?: number;
}

interface BrandfetchLogo {
  type?: string;         // "logo" | "icon" | "symbol" | "other"
  theme?: string;        // "light" | "dark"
  formats?: BrandfetchLogoFormat[];
}

interface BrandfetchResponse {
  name?: string;
  domain?: string;
  logos?: BrandfetchLogo[];
}

/**
 * Look up a logo URL for a domain. Returns null if:
 *   - BRANDFETCH_API_KEY is blank (graceful no-op)
 *   - the domain isn't in their index (404)
 *   - any error during the call (logged, swallowed — caller falls back)
 */
export async function fetchLogoForDomain(domain: string): Promise<string | null> {
  if (!env.BRANDFETCH_API_KEY) {
    return null;
  }
  const cleaned = sanitizeDomain(domain);
  if (!cleaned) return null;

  try {
    const resp = await retry(
      () =>
        fetch(`${BASE_URL}/brands/${encodeURIComponent(cleaned)}`, {
          headers: {
            Authorization: `Bearer ${env.BRANDFETCH_API_KEY}`,
            Accept: "application/json",
          },
        }),
      { maxAttempts: 2 },
    );
    if (resp.status === 404) {
      log.info({ domain: cleaned }, "brandfetch.not_indexed");
      return null;
    }
    if (!resp.ok) {
      log.warn({ domain: cleaned, status: resp.status }, "brandfetch.bad_status");
      return null;
    }
    const data = (await resp.json()) as BrandfetchResponse;
    const url = pickBestLogo(data.logos ?? []);
    log.info({ domain: cleaned, found: !!url }, "brandfetch.lookup");
    return url;
  } catch (err) {
    log.warn({ domain: cleaned, err: String(err) }, "brandfetch.error");
    return null;
  }
}

function pickBestLogo(logos: BrandfetchLogo[]): string | null {
  if (!logos.length) return null;
  // Preference order: full logo (dark theme = readable on light bg) → full logo
  // → icon → symbol. Within each, prefer SVG, then PNG, then anything.
  const order: Array<(l: BrandfetchLogo) => boolean> = [
    (l) => l.type === "logo" && l.theme === "dark",
    (l) => l.type === "logo",
    (l) => l.type === "symbol",
    (l) => l.type === "icon",
    () => true,
  ];
  for (const match of order) {
    const candidate = logos.find(match);
    if (!candidate?.formats?.length) continue;
    const fmtOrder = ["svg", "png", "jpeg"];
    for (const fmt of fmtOrder) {
      const f = candidate.formats.find((x) => x.format === fmt && x.src);
      if (f?.src) return f.src;
    }
    const any = candidate.formats.find((f) => f.src);
    if (any?.src) return any.src;
  }
  return null;
}

/** Strip protocol / path / port; lowercase. Returns null on garbage input. */
function sanitizeDomain(input: string): string | null {
  try {
    const url = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}
