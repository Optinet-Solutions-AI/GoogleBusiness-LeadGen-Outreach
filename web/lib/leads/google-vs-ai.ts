/**
 * leads/google-vs-ai.ts — the "Google vs AI Lookup" box: where the details we scraped from Google disagree with what
 * AI Lookup found on the web, so the operator double-checks them (20 Nov 2026). Pure, client-safe.
 *
 * Inputs:  the lead's Google details (website, phone, address) + the AI Lookup findings
 * Outputs: one line per disagreement with a plain note; the lead patch when the operator Verifies an AI website
 * Used by: components/leads/ResearchPanel.tsx (the box), lib/leads/research-decide.ts (Verify on "Website")
 *
 * AI finding nothing is never a disagreement (it often misses). Nothing here changes a lead by itself: an AI website
 * becomes the lead's website only when the operator presses Verify.
 */
import { routeOffer } from "@/lib/offers";
import { hasRealWebsite } from "@/lib/filters";
import { samePhone } from "./research-review";

export interface GoogleDetails {
  website_url: string | null;
  website_kind: string | null;
  phone: string | null;
  address: string | null;
}

export interface AiDetails {
  website: string | null;
  phones: string[];
  address: string | null;
}

export interface Discrepancy {
  field: "website" | "phone" | "address";
  google: string | null;
  ai: string | null;
  note: string;
}

const host = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[/?#].*$/, "");

const ABBR: Record<string, string> = {
  north: "n", south: "s", east: "e", west: "w", avenue: "ave", street: "st", road: "rd", drive: "dr",
  boulevard: "blvd", suite: "ste", highway: "hwy", lane: "ln", court: "ct", place: "pl",
};
const words = (a: string) =>
  a
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w);

/** Same place? Street numbers decide when both have one; otherwise the first words must overlap. */
function sameAddress(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  const nx = x.find((w) => /^\d+$/.test(w));
  const ny = y.find((w) => /^\d+$/.test(w));
  if (nx && ny) return nx === ny;
  const head = new Set(x.slice(0, 4));
  return y.slice(0, 4).some((w) => head.has(w));
}

export function googleVsAi(g: GoogleDetails, ai: AiDetails): Discrepancy[] {
  const out: Discrepancy[] = [];
  const googleSite = g.website_kind === "real" && g.website_url ? g.website_url : null;
  // Results saved before 20 Nov 2026 may hold a social homepage or a dead business.site link: not a website.
  if (ai.website && hasRealWebsite(ai.website)) {
    if (!googleSite) {
      out.push({ field: "website", google: null, ai: ai.website, note: "Google has no website for them. AI found this one — open it and press Verify if it's theirs." });
    } else if (host(googleSite) !== host(ai.website)) {
      out.push({ field: "website", google: googleSite, ai: ai.website, note: "AI found a different website from Google's. Open both and keep the right one." });
    }
  }
  if (ai.phones.length && !ai.phones.some((p) => samePhone(p, g.phone))) {
    out.push(
      g.phone
        ? { field: "phone", google: g.phone, ai: ai.phones[0], note: "AI found a different phone number. Google's may be out of date." }
        : { field: "phone", google: null, ai: ai.phones[0], note: "Google has no phone for them. AI found this one." },
    );
  }
  if (ai.address && g.address && !sameAddress(g.address, ai.address)) {
    out.push({ field: "address", google: g.address, ai: ai.address, note: "The address is different. The business may have moved." });
  }
  return out;
}

/**
 * Verify on an AI website: it becomes the lead's website. A normal lead then counts as having a site (not audited
 * yet), so it moves off the "you have no website" pitch to AI services; conference / review-site / closure leads keep
 * their own offer.
 */
export function websiteVerifyPatch(lead: { signal_type: string | null }, url: string): Record<string, unknown> {
  const base = { website_url: url, website_kind: "real", has_website: true };
  if (lead.signal_type) return base;
  const route = routeOffer({ has_website: true, needs_improvement: null, signal_type: null });
  // The old site's AI website check no longer applies (migration 069; saved through lib/leads/save-lead.ts).
  return {
    ...base,
    call_segment: route.segment,
    primary_offer: route.primary_offer,
    secondary_offer: route.secondary_offer,
    website_review: null,
    website_reviewed_at: null,
  };
}
