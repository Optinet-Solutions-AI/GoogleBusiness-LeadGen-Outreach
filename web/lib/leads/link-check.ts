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

export function linkKind(url: string): "social" | "web" | "invalid" {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "invalid";
  }
  return SOCIAL.test(host) ? "social" : "web";
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
