/**
 * openai-profile.ts — research one business with OpenAI web search and return a short, sourced profile.
 *
 * Inputs:  { business_name, website_url?, address?, country_code?, category? }
 * Outputs: AiProfile — summary, what they do, owner / people, emails, phones, website, contact page, address, hours,
 *          socials, services, founded, size, reviews, sources; usd = estimated cost
 * Used by: lib/leads/ai-profile.ts (the lead page "AI profile" button)
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
    owner_name: nullableString("Owner / director / manager name as publicly listed"),
    owner_role: nullableString("That person's role"),
    people: {
      type: "array",
      description: "Other key people publicly listed (max 5)",
      items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, role: { type: ["string", "null"] } }, required: ["name", "role"] },
    },
    emails: { type: "array", items: { type: "string" }, description: "Business emails exactly as published (max 3)" },
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
export function profilePrompt(b: { business_name: string; website_url?: string | null; address?: string | null; country_code?: string | null; category?: string | null }): string {
  return [
    `Research this business and summarise what is publicly known, for a salesperson about to contact it.`,
    `Business: ${b.business_name}`,
    b.category ? `Type: ${b.category}` : "",
    b.website_url ? `Website: ${b.website_url}` : `Website: unknown`,
    b.address ? `Address: ${b.address}` : "",
    b.country_code ? `Country: ${b.country_code.toUpperCase()}` : "",
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
  const emails = strList(raw.emails, 5)
    .map((e) => e.toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && pickEmail([e], host) === e)
    .slice(0, 3);
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
    owner_name: str(raw.owner_name, 80),
    owner_role: str(raw.owner_role, 80),
    people,
    emails,
    phones,
    website: isUrl(site) ? site : null,
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
