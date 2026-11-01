/**
 * openai-contacts.ts — find a business's contact details (email, phone, contact page, owner) with OpenAI web search.
 *
 * Inputs:  { business_name, website_url?, address?, country_code? }
 * Outputs: AiContacts — each field null unless OpenAI found it on a page it cites; usd = estimated cost
 * Used by: lib/pipeline/stage-1-scrape.ts (leads the free site crawl left without an email), scripts/backfill-emails.ts
 *
 * Uses the Responses API with the web_search tool (model OPENAI_CONTACT_MODEL, default gpt-5.4-mini) and a strict
 * JSON schema. The model is told to read the business's own site first (footer, contact and about pages), then
 * reliable listings, and to return null rather than guess. We keep an email only if it passes the same junk
 * filter as the site crawler, and a field only when a source URL backs the result. Business contacts only:
 * the owner is a name + role as publicly listed, never a personal address hunted down. Paid: ~1–3 cents a lead.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { pickEmail } from "./website-email";

const log = getLogger("openai-contacts");
const URL_RESPONSES = "https://api.openai.com/v1/responses";

export type AiContacts = {
  email: string | null;
  phone: string | null;
  contact_url: string | null;
  owner_name: string | null;
  owner_role: string | null;
  sources: string[];
  usd: number;
};

export function isAiContactsConfigured(): boolean {
  return env.OPENAI_API_KEY.trim().length > 0;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    email: { type: ["string", "null"], description: "Business contact email exactly as published, or null" },
    phone: { type: ["string", "null"], description: "Business phone in international format, or null" },
    contact_url: { type: ["string", "null"], description: "URL of the business's own contact page, or null" },
    owner_name: { type: ["string", "null"], description: "Owner / director / manager name as publicly listed, or null" },
    owner_role: { type: ["string", "null"], description: "That person's role, e.g. Owner, Director, or null" },
    sources: { type: "array", items: { type: "string" }, description: "URLs of the pages the answers came from" },
  },
  required: ["email", "phone", "contact_url", "owner_name", "owner_role", "sources"],
} as const;

/** The instruction sent with each lookup. Pure. */
export function contactPrompt(b: { business_name: string; website_url?: string | null; address?: string | null; country_code?: string | null }): string {
  return [
    `Find the public business contact details for this company.`,
    `Business: ${b.business_name}`,
    b.website_url ? `Website: ${b.website_url}` : `Website: unknown`,
    b.address ? `Address: ${b.address}` : "",
    b.country_code ? `Country: ${b.country_code.toUpperCase()}` : "",
    ``,
    `Steps: read the business's own website first — the footer, the contact page (it may be called "Get in touch",`,
    `"Contact", "Kuntatt", "Contatti", "Contacto"…) and the about page. Then check reliable listings (Google Business,`,
    `official registries, Facebook page, trade directories) for the same business at this address.`,
    `Return the business email and phone exactly as published, the URL of its own contact page, and the owner or`,
    `director's name and role only if a public page states it. Use null for anything you did not see on a page.`,
    `Never guess or construct an email address. List every page you used in "sources".`,
  ]
    .filter(Boolean)
    .join("\n");
}

type ResponseBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** Pull and sanity-check the model's JSON answer. Pure. */
export function parseContacts(body: ResponseBody, websiteUrl: string | null, usd: number): AiContacts {
  const text = (body.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  let raw: Partial<Record<keyof AiContacts, unknown>> = {};
  try {
    raw = JSON.parse(text);
  } catch {
    /* empty answer */
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s)) : [];
  let host = "";
  try {
    host = websiteUrl ? new URL(websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`).host : "";
  } catch {
    /* none */
  }
  const emailRaw = str(raw.email)?.toLowerCase() ?? null;
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailRaw) ? pickEmail([emailRaw], host) : null;
  const phone = str(raw.phone);
  const contactUrl = str(raw.contact_url);
  const backed = sources.length > 0;
  return {
    email: backed ? email : null,
    phone: backed && phone && phone.replace(/\D/g, "").length >= 7 ? phone : null,
    contact_url: backed && contactUrl && /^https?:\/\//.test(contactUrl) ? contactUrl : null,
    owner_name: backed ? str(raw.owner_name) : null,
    owner_role: backed ? str(raw.owner_role) : null,
    sources,
    usd,
  };
}

/** Estimated cost: tokens at the configured rates + the web-search calls. Pure. */
export function lookupCostUsd(usage: ResponseBody["usage"], searches: number): number {
  const inUsd = ((usage?.input_tokens ?? 0) / 1e6) * env.OPENAI_CONTACT_USD_PER_MTOK_IN;
  const outUsd = ((usage?.output_tokens ?? 0) / 1e6) * env.OPENAI_CONTACT_USD_PER_MTOK_OUT;
  return Math.round((inUsd + outUsd + searches * env.OPENAI_CONTACT_USD_PER_SEARCH) * 1e5) / 1e5;
}

export async function findContactsWithAI(b: {
  business_name: string;
  website_url?: string | null;
  address?: string | null;
  country_code?: string | null;
}): Promise<AiContacts> {
  if (!isAiContactsConfigured()) throw new Error("OPENAI_API_KEY missing");
  const started = Date.now();
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_CONTACT_MODEL,
          tools: [{ type: "web_search" }],
          input: contactPrompt(b),
          text: { format: { type: "json_schema", name: "business_contacts", schema: SCHEMA, strict: true } },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`openai ${r.status}`);
      return r;
    },
    { maxAttempts: 2 },
  );
  if (!res.ok) {
    log.warn({ name: b.business_name, status: res.status, ms: Date.now() - started }, "openai_contacts.error");
    throw new Error(`openai contacts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as ResponseBody;
  const searches = (body.output ?? []).filter((o) => o.type === "web_search_call").length;
  const out = parseContacts(body, b.website_url ?? null, lookupCostUsd(body.usage, searches));
  log.info(
    { name: b.business_name, email: !!out.email, phone: !!out.phone, contact_url: !!out.contact_url, owner: !!out.owner_name, searches, usd: out.usd, ms: Date.now() - started },
    "openai_contacts.done",
  );
  return out;
}
