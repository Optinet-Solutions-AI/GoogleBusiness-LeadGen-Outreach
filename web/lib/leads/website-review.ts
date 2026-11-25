/**
 * website-review.ts — the OpenAI website check's rules. Pure (no network, no DB).
 *
 * Inputs:  the page signals we measured + the AI's JSON answer
 * Outputs: WebsiteReview (verdict, score, reasons, design, what to pitch and why, technical checks, screenshot),
 *          the lead fields it sets, the rows the lead page shows, the prompt + answer schema
 * Used by: lib/services/website-review.ts, lib/pipeline/stage-1-scrape.ts, lib/leads/website-recheck.ts,
 *          app/(dashboard)/leads/[id]/page.tsx
 *
 * Operator decision (25 Nov 2026): the free score (https / viewport / speed / copyright) was too often wrong, so
 * OpenAI looks at a screenshot of the homepage plus what we measured and decides No / Old / Good website. The
 * verdict decides the pitch; there is no manual dropdown any more, only "Check website again".
 */

export type SiteVerdict = "no_website" | "old_website" | "good_website";
export type SitePitch = "website_build" | "website_redesign" | "ai_services";

/** What we measured on their homepage (headless Chromium). */
export interface SiteSignals {
  final_url: string;
  https: boolean;
  mobile_meta: boolean;
  load_seconds: number | null;
  copyright_year: number | null;
  has_contact_form: boolean;
  has_booking: boolean;
  platform: string | null;
  title: string | null;
}

export interface WebsiteReview {
  verdict: SiteVerdict;
  score: number;
  summary: string;
  design: string | null;
  reasons: string[];
  pitch: { offer: SitePitch; why: string; ideas: string[] };
  checks: SiteSignals;
  screenshot_url: string | null;
  model: string;
  usd: number;
  checked_at: string;
}

export const VERDICT_LABEL: Record<SiteVerdict, string> = {
  no_website: "No real website",
  old_website: "Old or weak website",
  good_website: "Good website",
};

export const PITCH_LABEL: Record<SitePitch, string> = {
  website_build: "Offer a new website",
  website_redesign: "Offer a redesign",
  ai_services: "Offer AI services (booking, receptionist), not a website",
};

const PITCH_FOR: Record<SiteVerdict, SitePitch> = {
  no_website: "website_build",
  old_website: "website_redesign",
  good_website: "ai_services",
};

const VERDICTS: readonly SiteVerdict[] = ["no_website", "old_website", "good_website"];
const MAX_REASONS = 6;
const MAX_IDEAS = 4;
const SLOW_SECONDS = 4;

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_business_site: {
      type: "boolean",
      description: "false when the page is not really this business's own website (parked, for sale, under construction, a directory or social page, another business)",
    },
    verdict: { type: "string", enum: VERDICTS as unknown as string[] },
    score: { type: "integer", description: "0–100, how well the site works as a modern business website" },
    summary: { type: "string", description: "One plain sentence: what the site is like" },
    design: { type: "string", description: "One or two sentences on how it looks (layout, photos, text, colours)" },
    reasons: { type: "array", items: { type: "string" }, description: "Up to 6 short reasons for the verdict" },
    pitch_why: { type: "string", description: "One or two sentences: why this business would want what we offer" },
    pitch_ideas: { type: "array", items: { type: "string" }, description: "Up to 4 concrete things we could add or fix" },
  },
  required: ["is_business_site", "verdict", "score", "summary", "design", "reasons", "pitch_why", "pitch_ideas"],
} as const;

export function reviewPrompt(b: {
  business_name: string;
  category: string | null;
  city: string | null;
  url: string;
  signals: SiteSignals;
  text: string;
}): string {
  const s = b.signals;
  const yn = (v: boolean) => (v ? "yes" : "no");
  return [
    `You review the homepage of a local business for a web agency. The screenshot shows the top of the homepage.`,
    `Business: ${b.business_name}${b.category ? ` (${b.category})` : ""}${b.city ? `, ${b.city}` : ""}. Address we opened: ${b.url}`,
    ``,
    `What we measured: final address ${s.final_url}; https ${yn(s.https)}; phone layout tag ${yn(s.mobile_meta)}; ` +
      `load time ${s.load_seconds ?? "unknown"} s; newest year on the page ${s.copyright_year ?? "none"}; ` +
      `contact form ${yn(s.has_contact_form)}; online booking ${yn(s.has_booking)}; built with ${s.platform ?? "unknown"}; ` +
      `page title "${s.title ?? ""}".`,
    ``,
    `Decide the verdict:`,
    `- no_website: not really their own working website (parked or for-sale domain, "coming soon", a directory or social page, another business, nearly empty).`,
    `- old_website: their own site, but dated or weak: old design, hard to use on a phone, slow, thin or outdated content, no clear way to call or book.`,
    `- good_website: a modern, clear, working site that a customer would trust today.`,
    `Judge mostly by how it looks and reads to a customer today, using the measurements as support. Be strict: a site that looks 8+ years old is old_website even if it works.`,
    `Write the summary, design, reasons and pitch in plain English for a salesperson, no jargon. Reasons are short (under 10 words each).`,
    `For pitch_why and pitch_ideas: no_website → a new website; old_website → a redesign; good_website → AI services (online booking, an AI receptionist that answers calls, a chat assistant), never a website.`,
    ``,
    `Page text (start):`,
    b.text.slice(0, 3000),
  ].join("\n");
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max: number, each = 160): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : [];

/** The AI's JSON → a review, or null when it can't be read (the free check's result then stays). */
export function parseReview(
  raw: unknown,
  ctx: { signals: SiteSignals; screenshot_url: string | null; model: string; usd: number; checked_at: string },
): WebsiteReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!VERDICTS.includes(r.verdict as SiteVerdict)) return null;
  const verdict: SiteVerdict = r.is_business_site === false ? "no_website" : (r.verdict as SiteVerdict);
  const n = Number(r.score);
  const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  return {
    verdict,
    score,
    summary: str(r.summary, 300),
    design: str(r.design, 400) || null,
    reasons: strList(r.reasons, MAX_REASONS),
    pitch: { offer: PITCH_FOR[verdict], why: str(r.pitch_why, 400), ideas: strList(r.pitch_ideas, MAX_IDEAS) },
    checks: ctx.signals,
    screenshot_url: ctx.screenshot_url,
    model: ctx.model,
    usd: ctx.usd,
    checked_at: ctx.checked_at,
  };
}

/** The lead fields the verdict sets (the segment / offer then follow through routeOffer). */
export function reviewFields(r: WebsiteReview): {
  has_website: boolean;
  website_kind: "real" | "none";
  needs_improvement: boolean;
  website_score: number;
  website_issues: string[];
} {
  return {
    has_website: r.verdict !== "no_website",
    // Like a parked domain: "none" so Build (stage 2) doesn't read the address as a real site and re-route the lead.
    website_kind: r.verdict === "no_website" ? "none" : "real",
    needs_improvement: r.verdict === "old_website",
    website_score: r.score,
    website_issues: r.reasons,
  };
}

/** The technical checks as plain rows: ok = good (true), bad (false) or just information (null). */
export function checkRows(c: SiteSignals): { label: string; value: string; ok: boolean | null }[] {
  const yesNo = (v: boolean) => (v ? "Yes" : "No");
  const thisYear = new Date().getFullYear();
  return [
    { label: "Secure (https)", value: yesNo(c.https), ok: c.https },
    { label: "Works on phones", value: yesNo(c.mobile_meta), ok: c.mobile_meta },
    {
      label: "Load time",
      value: c.load_seconds == null ? "Unknown" : `${c.load_seconds} s`,
      ok: c.load_seconds == null ? null : c.load_seconds <= SLOW_SECONDS,
    },
    {
      label: "Newest year on the page",
      value: c.copyright_year == null ? "None found" : String(c.copyright_year),
      ok: c.copyright_year == null ? null : thisYear - c.copyright_year <= 2,
    },
    { label: "Contact form", value: yesNo(c.has_contact_form), ok: c.has_contact_form },
    { label: "Online booking", value: yesNo(c.has_booking), ok: c.has_booking },
    { label: "Built with", value: c.platform ?? "Unknown", ok: null },
  ];
}

const PLATFORMS: [RegExp, string][] = [
  [/wordpress|wp-content/i, "WordPress"],
  [/wix\.com|wixstatic|wixsite/i, "Wix"],
  [/squarespace/i, "Squarespace"],
  [/shopify/i, "Shopify"],
  [/godaddy|secureserver\.net\/.*websites|img1\.wsimg\.com/i, "GoDaddy"],
  [/weebly/i, "Weebly"],
  [/webflow/i, "Webflow"],
  [/duda|dudaone|multiscreensite/i, "Duda"],
  [/joomla/i, "Joomla"],
  [/drupal/i, "Drupal"],
];

/** Which site builder made it, from the generator tag first, then tell-tale addresses in the page's code. */
export function platformFrom(p: { generator: string | null; html: string }): string | null {
  for (const src of [p.generator ?? "", p.html]) {
    if (!src) continue;
    for (const [re, name] of PLATFORMS) if (re.test(src)) return name;
  }
  return null;
}

const BOOKING_WORDS = /\b(book (now|online|an? (appointment|table|visit))|online booking|reserve (a|your) table|make a reservation|schedule (an? )?(appointment|service|visit)|request an appointment)\b/i;
const BOOKING_TOOLS = /opentable|resy\.com|calendly|acuityscheduling|square(up)?\.com\/appointments|vagaro|booksy|fresha|housecallpro|servicetitan|jobber|setmore|schedulicity|zocdoc|mindbodyonline|tock\.com|sevenrooms/i;

/** Does the homepage offer online booking: the words, or a known booking tool linked / embedded? */
export function bookingFrom(p: { text: string; html: string }): boolean {
  return BOOKING_WORDS.test(p.text) || BOOKING_TOOLS.test(p.html);
}

/** The few review fields the leads lists read (lib/leads/website-verdicts.ts); score may come back as text. */
export type VerdictSummary = { verdict: SiteVerdict; score: number | string | null; summary: string | null; pitch_why: string | null };

const SHORT_LABEL: Record<SiteVerdict, string> = {
  no_website: "No website",
  old_website: "Old website",
  good_website: "Good website",
};

const BADGE_TONE: Record<SiteVerdict, "success" | "warning" | "neutral"> = {
  no_website: "success",
  old_website: "warning",
  good_website: "neutral",
};

/** The website badge on the Leads / batch tables: the AI verdict + score, with the reason and pitch on hover. */
export function verdictBadge(v: VerdictSummary): { label: string; tone: "success" | "warning" | "neutral"; title: string } {
  const n = Number(v.score);
  const score = v.verdict !== "no_website" && Number.isFinite(n) ? ` · ${Math.round(n)}` : "";
  const title = [
    `AI website check: ${VERDICT_LABEL[v.verdict]}${score ? ` (${Math.round(n)}/100)` : ""}.`,
    v.summary ?? "",
    `${PITCH_LABEL[PITCH_FOR[v.verdict]]}.`,
    v.pitch_why ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return { label: `${SHORT_LABEL[v.verdict]}${score}`, tone: BADGE_TONE[v.verdict], title };
}
