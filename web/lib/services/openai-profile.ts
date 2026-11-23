/**
 * openai-profile.ts — research one business with OpenAI web search and return a short, sourced profile.
 *
 * Inputs:  { business_name, website_url?, address?, country_code?, category?, seen_at? (e.g. the show they exhibit at),
 *          notice? (the WARN / SEC notice a closing business comes from) }
 * Outputs: AiProfile — summary, what they do, owner / people, emails (+ who each one reaches), phones, website,
 *          contact page, address, hours,
 *          socials, services, founded, size, reviews, sources; usd = estimated cost
 * Used by: lib/leads/ai-profile.ts (the lead page "AI Lookup" button), lib/pipeline/stage-1-scrape.ts (scraping)
 *
 * The main question is "who can I email at this company for business?" (QA 20 Nov 2026: a summary-style question
 * returned PlayStation's US customer-support line and no email): any publicly listed business email counts, also a
 * regional office, the parent company, an agency named as representing them or the event organiser, each labelled
 * with who it reaches. No-reply addresses are dropped; the owner is a person's name, never a company.
 *
 * Same API and rules as openai-contacts.ts (Responses API + web_search, strict JSON schema, model
 * OPENAI_CONTACT_MODEL): only what a cited public page shows, null / empty rather than a guess, emails through
 * the same junk filter, nothing kept unless at least one source URL backs it. Business details only: people are
 * names + roles as publicly listed, never personal contact details. Paid: about 2–5 cents a lead.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { pickEmail } from "./website-email";
import { hasRealWebsite } from "../filters";
import { lookupCostUsd, isAiContactsConfigured } from "./openai-contacts";
import { failOpenAi, recordOpenAiResult, shouldRetryOpenAi } from "./openai-health";

const log = getLogger("openai-profile");
const URL_RESPONSES = "https://api.openai.com/v1/responses";

export interface AiProfile {
  summary: string | null;
  what_they_do: string | null;
  owner_name: string | null;
  owner_role: string | null;
  people: { name: string; role: string | null }[];
  emails: string[];
  /** Who each email reaches, by lower-case email (e.g. "Their PR agency in Greece"). Absent on older results. */
  email_notes?: Record<string, string>;
  /** Whose inbox each email is (23 Nov 2026): the business itself, its head office / franchisor, or an agency. */
  email_scope?: Record<string, "own" | "head_office" | "agency">;
  phones: string[];
  website: string | null;
  contact_url: string | null;
  address: string | null;
  hours: string | null;
  socials: { platform: string; url: string }[];
  services: string[];
  founded: string | null;
  size: string | null;
  reviews: string | null;
  sources: string[];
  usd: number;
}

export const isAiProfileConfigured = isAiContactsConfigured;

const nullableString = (description: string) => ({ type: ["string", "null"], description });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: nullableString("2–3 plain sentences: who they are, what they do, anything useful before contacting them"),
    what_they_do: nullableString("One short line, e.g. 'Family-run plumbing and heating company'"),
    owner_name: nullableString("A PERSON's name (owner / director / manager) as publicly listed — never a company name"),
    owner_role: nullableString("That person's role"),
    people: {
      type: "array",
      description: "Other key people publicly listed (max 5)",
      items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, role: { type: ["string", "null"] } }, required: ["name", "role"] },
    },
    emails: {
      type: "array",
      description: "Emails for business outreach exactly as published, best first (max 5)",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          email: { type: "string" },
          reaches: { type: "string", description: "Who it reaches, a few words, e.g. 'Marketing team, Greece' or 'Their PR agency in Athens'" },
          scope: {
            type: "string",
            enum: ["this_business", "head_office", "agency"],
            description:
              "this_business = this business / this exact branch or location / its owner; head_office = a parent company, franchisor, corporate or national head office; agency = an agency or event organiser representing it",
          },
        },
        required: ["email", "reaches", "scope"],
      },
    },
    phones: { type: "array", items: { type: "string" }, description: "Business phones in international format (max 3)" },
    website: nullableString("The business's own website"),
    contact_url: nullableString("URL of its own contact page"),
    address: nullableString("Business address as published"),
    hours: nullableString("Opening hours in one short line"),
    socials: {
      type: "array",
      description: "The business's own social profiles",
      items: { type: "object", additionalProperties: false, properties: { platform: { type: "string" }, url: { type: "string" } }, required: ["platform", "url"] },
    },
    services: { type: "array", items: { type: "string" }, description: "Main services or products (max 6, a few words each)" },
    founded: nullableString("Year founded or 'over 20 years' if stated"),
    size: nullableString("Team size / number of locations if stated"),
    reviews: nullableString("Rating and review count if shown, e.g. '4.8 on Google (120 reviews)'"),
    sources: { type: "array", items: { type: "string" }, description: "URLs of every page used" },
  },
  required: [
    "summary", "what_they_do", "owner_name", "owner_role", "people", "emails", "phones", "website", "contact_url",
    "address", "hours", "socials", "services", "founded", "size", "reviews", "sources",
  ],
} as const;

/** The instruction sent with each lookup. Pure. */
export function profilePrompt(b: {
  business_name: string;
  website_url?: string | null;
  address?: string | null;
  country_code?: string | null;
  category?: string | null;
  seen_at?: string | null;
  /** A public notice the lead comes from (WARN layoff / closure, SEC filing): see lookupNotice. */
  notice?: string | null;
}): string {
  return [
    `A salesperson wants to contact this company about doing business with them (not as a customer).`,
    `Business: ${b.business_name}`,
    b.category ? `Type: ${b.category}` : "",
    b.website_url ? `Website: ${b.website_url}` : `Website: unknown`,
    b.address ? `Address: ${b.address}` : "",
    b.country_code ? `Country: ${b.country_code.toUpperCase()}` : "",
    b.seen_at ? `Seen at: ${b.seen_at}` : "",
    b.notice ? `Public notice: ${b.notice}` : "",
    b.notice
      ? `This company is the employer named in the notice, at that place. If a bigger company (a bank, a chain) has a similar name, find the business behind this notice and say in the summary which company it is.`
      : "",
    ``,
    `Main question: who can I email at this company? Find the best publicly listed emails for business outreach, best`,
    `first, focused on the country / region above: the company's own site, its office or team for this country or`,
    `region, its parent company, an agency publicly named as representing it (PR, marketing), or the event organiser.`,
    `For each email say in a few words who it reaches, and whose inbox it is: this business itself (this branch or`,
    `location, or its owner), a head office (parent company, franchisor, corporate or national office), or an agency.`,
    `Skip customer-support, no-reply and job-application addresses`,
    `unless nothing else exists. Name the decision-maker for this region (marketing / partnerships / owner) when a page`,
    `states it. Then fill the rest of the profile, short and factual.`,
    ``,
    `Read the business's own website first (home, about, contact, footer), then reliable listings (Google Business,`,
    `official registries, its Facebook / Instagram / LinkedIn pages, trade directories) for the same business at this`,
    `address. Fill each field only with what a page you read states; use null or an empty list otherwise. Never guess`,
    `or construct an email address. People: names and roles as published on business pages only. List every page used`,
    `in "sources". Keep the summary factual and short.`,
  ]
    .filter(Boolean)
    .join("\n");
}

type ResponseBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/\S+$/.test(s.trim());
const str = (v: unknown, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strList = (v: unknown, max: number, len = 120) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, len)).filter((x): x is string => !!x))].slice(0, max) : [];

const NO_REPLY = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon)[@+._-]/i;
/** An "owner" that is really a company (e.g. "Sony Interactive Entertainment"). */
const COMPANY =
  /\b(inc|llc|ltd|limited|gmbh|corp|corporation|company|group|holdings?|enterprises?|plc|pty|studios?)\b\.?$|\b(entertainment|corporation|holdings|interactive|enterprises)\b/i;

/** The conference a lead was seen at, for the lookup ("Gameathlon 2026 in Athens (GR), stand 5K40"). Pure. */
export function lookupSeenAt(signalType: string | null | undefined, meta: Record<string, unknown> | null | undefined): string | null {
  if (signalType !== "exhibitor" || !meta) return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const event = s(meta.event_name);
  if (!event) return null;
  const city = s(meta.event_city);
  const country = s(meta.event_country)?.toUpperCase() ?? null;
  const where = city ? ` in ${city}${country ? ` (${country})` : ""}` : country ? ` (${country})` : "";
  const booth = s(meta.booth);
  return `${event}${where}${booth ? `, stand ${booth}` : ""}`;
}

const SIGNAL_WORDS: Record<string, string> = {
  closure: "closure",
  layoff: "layoff",
  unspecified: "closure or layoff",
  bankruptcy: "bankruptcy",
  listing: "listing",
};

/**
 * The public notice a closing-business lead comes from, for the lookup (23 Nov 2026: AI Lookup now runs on these
 * leads too). Saying where and when helps AI find the employer behind the notice, not a bigger company with a
 * similar name (QA: "Truist Bank" was really its affiliate Regional Acceptance Corporation). Pure.
 */
export function lookupNotice(signalType: string | null | undefined, meta: Record<string, unknown> | null | undefined): string | null {
  if (!signalType || !meta || signalType === "exhibitor" || signalType === "review_site") return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const what = SIGNAL_WORDS[signalType] ?? signalType;
  const company = s(meta.company_raw);
  const by = company ? ` by ${company}` : "";
  if (s(meta.filed) || s(meta.accession) || s(meta.cik)) {
    const filed = s(meta.filed);
    const state = s(meta.state);
    const items = Array.isArray(meta.items) ? (meta.items as unknown[]).map(s).filter(Boolean) : [];
    return `SEC 8-K${filed ? ` filed ${filed}` : ""}${by}${state ? ` (${state})` : ""}: ${what}${items.length ? ` (item ${items.join(", ")})` : ""}`;
  }
  const date = s(meta.notice_date);
  const place = [s(meta.location), s(meta.state)].filter(Boolean).join(", ");
  const jobs = s(meta.employees_affected);
  if (!date && !place && !jobs) return null;
  return `WARN notice${date ? ` filed ${date}` : ""}${by}${place ? ` for ${place}` : ""}: ${jobs ? `${jobs} jobs affected ` : ""}(${what})`;
}

/** Pull and sanity-check the model's JSON answer. Pure. Nothing is kept unless a source backs it. */
export function parseProfile(body: ResponseBody, websiteUrl: string | null, usd: number): AiProfile {
  const text = (body.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* empty answer */
  }
  const sources = Array.isArray(raw.sources) ? [...new Set(raw.sources.filter(isUrl).map((s) => s.trim()))].slice(0, 12) : [];
  const empty: AiProfile = {
    summary: null, what_they_do: null, owner_name: null, owner_role: null, people: [], emails: [], phones: [],
    website: null, contact_url: null, address: null, hours: null, socials: [], services: [], founded: null,
    size: null, reviews: null, sources: [], usd,
  };
  if (!sources.length) return empty;

  const site = str(raw.website) ?? websiteUrl;
  let host = "";
  try {
    host = site ? new URL(site.includes("://") ? site : `https://${site}`).host : "";
  } catch {
    /* none */
  }
  // Emails come as { email, reaches } (a plain string from older answers is still read).
  const emailNotes: Record<string, string> = {};
  const emailScopes: Record<string, "own" | "head_office" | "agency"> = {};
  const SCOPES: Record<string, "own" | "head_office" | "agency"> = { this_business: "own", head_office: "head_office", agency: "agency" };
  const emails = (Array.isArray(raw.emails) ? (raw.emails as unknown[]) : [])
    .map((x) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : { email: x };
      const e = str(o.email, 120)?.toLowerCase() ?? null;
      const note = str(o.reaches, 120);
      if (e && note && !emailNotes[e]) emailNotes[e] = note;
      const scope = typeof o.scope === "string" ? SCOPES[o.scope] : undefined;
      if (e && scope && !emailScopes[e]) emailScopes[e] = scope;
      return e;
    })
    .filter((e): e is string => !!e && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && !NO_REPLY.test(e) && pickEmail([e], host) === e)
    .filter((e, i, all) => all.indexOf(e) === i)
    .slice(0, 5);
  const notes = Object.fromEntries(emails.filter((e) => emailNotes[e]).map((e) => [e, emailNotes[e]]));
  const scopes = Object.fromEntries(emails.filter((e) => emailScopes[e]).map((e) => [e, emailScopes[e]]));
  const ownerName = str(raw.owner_name, 80);
  const ownerIsPerson = !!ownerName && !COMPANY.test(ownerName);
  const phones = strList(raw.phones, 3, 40).filter((p) => p.replace(/\D/g, "").length >= 7);
  const people = Array.isArray(raw.people)
    ? (raw.people as unknown[])
        .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
        .map((p) => ({ name: str(p.name, 80), role: str(p.role, 80) }))
        .filter((p): p is { name: string; role: string | null } => !!p.name)
        .slice(0, 5)
    : [];
  const socials = Array.isArray(raw.socials)
    ? (raw.socials as unknown[])
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
        .filter((s) => isUrl(s.url))
        .map((s) => ({ platform: str(s.platform, 30) ?? "Profile", url: String(s.url).trim() }))
        .slice(0, 6)
    : [];
  return {
    summary: str(raw.summary, 800),
    what_they_do: str(raw.what_they_do, 160),
    owner_name: ownerIsPerson ? ownerName : null,
    owner_role: ownerIsPerson ? str(raw.owner_role, 80) : null,
    people,
    emails,
    ...(Object.keys(notes).length ? { email_notes: notes } : {}),
    ...(Object.keys(scopes).length ? { email_scope: scopes } : {}),
    phones,
    // Only the business's own site: a social homepage or a dead business.site link is not a website.
    website: isUrl(site) && hasRealWebsite(site) ? site : null,
    contact_url: isUrl(raw.contact_url) ? String(raw.contact_url).trim() : null,
    address: str(raw.address, 200),
    hours: str(raw.hours, 200),
    socials,
    services: strList(raw.services, 6, 60),
    founded: str(raw.founded, 60),
    size: str(raw.size, 80),
    reviews: str(raw.reviews, 120),
    sources,
    usd,
  };
}

export async function profileWithAI(b: {
  business_name: string;
  website_url?: string | null;
  address?: string | null;
  country_code?: string | null;
  category?: string | null;
  seen_at?: string | null;
  notice?: string | null;
}): Promise<AiProfile> {
  if (!isAiProfileConfigured()) throw new Error("OPENAI_API_KEY missing");
  const started = Date.now();
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_CONTACT_MODEL,
          tools: [{ type: "web_search" }],
          input: profilePrompt(b),
          text: { format: { type: "json_schema", name: "business_profile", schema: SCHEMA, strict: true } },
        }),
        // The lead page waits on this (Vercel route cap 60 s): one try, stopped before the cap.
        signal: AbortSignal.timeout(55_000),
      });
      if (await shouldRetryOpenAi(r)) throw new Error(`openai ${r.status}`);
      return r;
    },
    { maxAttempts: 1 },
  );
  if (!res.ok) {
    log.warn({ name: b.business_name, status: res.status, ms: Date.now() - started }, "openai_profile.error");
    await failOpenAi(res, "ai-profile");
  }
  await recordOpenAiResult("ok", "ai-profile");
  const body = (await res.json()) as ResponseBody;
  const searches = (body.output ?? []).filter((o) => o.type === "web_search_call").length;
  const out = parseProfile(body, b.website_url ?? null, lookupCostUsd(body.usage, searches));
  log.info(
    { name: b.business_name, sources: out.sources.length, emails: out.emails.length, owner: !!out.owner_name, searches, usd: out.usd, ms: Date.now() - started },
    "openai_profile.done",
  );
  return out;
}
