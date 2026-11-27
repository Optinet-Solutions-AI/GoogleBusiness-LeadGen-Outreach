/**
 * leads/link-check.ts — does a lead's link actually open? The rules (27 Nov 2026, from the Explee walkthrough: their
 * tester found a dead LinkedIn link among the suggested leads). Pure (safe in client components).
 *
 * Inputs:  a URL; the answer to one request (HTTP status, or the network error)
 * Outputs: linkKind (social sites are never fetched: they block automated checks and we never get around that) ·
 *          linkVerdict (ok / dead / unknown — only a missing page or an address that doesn't exist is "dead") ·
 *          LinkCheck (what's saved in leads.link_checks, migration 080) · LINK_TEXT
 * Used by: lib/services/link-check.ts, lib/pipeline/stage-1-scrape.ts, components/leads/ContactCard.tsx
 */

export type LinkState = "ok" | "dead" | "unknown" | "unchecked";

export interface LinkCheck {
  url: string;
  state: LinkState;
  at: string;
}

/** What's saved on the lead: one entry per link we show. */
export interface LinkChecks {
  contact_page?: LinkCheck;
}

const SOCIAL = /(^|\.)(linkedin\.com|facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com)$/i;

/**
 * Is this a host on the public internet? Never open loopback, private, link-local (e.g. the cloud metadata server)
 * or internal names: a scraped link must not reach inside our own network. Literal addresses and names only.
 */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (h.includes(":")) {
    // IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10) are never public.
    if (h === "::1" || h === "::" || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return false;
  }
  return true;
}

export function linkKind(url: string): "social" | "web" | "invalid" | "internal" {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "invalid";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
  if (!isPublicHost(u.hostname)) return "internal";
  return SOCIAL.test(u.hostname) ? "social" : "web";
}

const DEAD_ERRORS = /ENOTFOUND|ECONNREFUSED|ERR_NAME_NOT_RESOLVED/i;

/**
 * One request's answer. Only a page that is gone (404 / 410) or an address that doesn't exist / refuses connections
 * is "dead". A block (401 / 403 / 429 / 999), server trouble (5xx) or a timeout is "unknown": never called dead.
 */
export function linkVerdict(r: { status?: number; error?: string }): "ok" | "dead" | "unknown" {
  if (typeof r.status === "number") {
    if (r.status >= 200 && r.status < 400) return "ok";
    if (r.status === 404 || r.status === 410) return "dead";
    return "unknown";
  }
  if (r.error && DEAD_ERRORS.test(r.error)) return "dead";
  return "unknown";
}

export const LINK_TEXT: Record<LinkState, string> = {
  ok: "Opens",
  dead: "Doesn't open (page gone or the address doesn't exist)",
  unknown: "Couldn't check it (the site blocked the check or didn't answer)",
  unchecked: "Social pages (LinkedIn, Facebook, Instagram…) can't be checked automatically: open it to make sure",
};
