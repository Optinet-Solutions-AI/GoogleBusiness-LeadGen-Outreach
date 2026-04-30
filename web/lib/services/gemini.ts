/**
 * gemini.ts — Google Gemini API client. Generates per-business website copy.
 *
 * Inputs:  lead (name, category, reviews, services hints) + page-set requested
 * Outputs: SiteCopy = home + about + per-service detail + service-area + contact
 * Used by: lib/pipeline/stage-3-generate.ts
 *
 * Pricing: Gemini 2.5 Flash free tier = ~1,500 requests/day. Plenty for the pilot.
 * Docs: https://ai.google.dev/gemini-api/docs
 *
 * We force JSON output via responseMimeType + responseSchema so the parser
 * doesn't have to guess.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("gemini");

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  if (!env.GOOGLE_GENAI_API_KEY) throw new Error("GOOGLE_GENAI_API_KEY missing");
  _client = new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY });
  return _client;
}

const SYSTEM_PROMPT = `You write multi-page website copy for small local businesses.

Voice: warm, confident, plain-English. Never use buzzwords like "world-class",
"best-in-class", "synergy", "solutions", "cutting-edge". Write like a neighbor.

The site you are writing has these pages:
  - Home (hero + trust signals)
  - About
  - Services index + one detail page per service
  - Service Area
  - Contact

Use ONLY facts you can ground in the supplied data. Do not invent licenses,
years in business, awards, or accolades. If data is thin, write tighter copy
— never fluff it.

Specific guidance for the premium-template fields:
  - cta_primary: 2–4 words, action-first ("Get a Free Quote", "Book a Visit").
  - cta_secondary: 2–4 words, lower-commitment ("Call Us", "See Reviews").
  - social_proof_line: ONE short sentence using ONLY supplied facts. If
    review_count >= 25 say "Trusted by N+ {city} homeowners/businesses".
    If <25, write something true and humble (e.g. "Locally owned in {city}").
    Do NOT invent counts.
  - urgency_micro: 3–6 words, reassurance not pressure ("Same-day calls
    answered", "Free quotes, no pressure").`;

export interface ServiceCopy {
  slug: string;            // url-safe slug, e.g. "drain-cleaning"
  name: string;            // display name, e.g. "Drain Cleaning"
  short_description: string;  // 1 sentence for the index page
  detail_paragraph: string;   // 2–3 sentences for the detail page
  bullets: string[];          // 3–5 deliverables / inclusions
}

export interface SiteCopy {
  hero_tagline: string;          // 6–12 words
  hero_subhead: string;          // 1 supporting sentence under the tagline
  trust_strip: string[];         // 3–4 short trust phrases (e.g. "Licensed & Insured")
  about_paragraph: string;       // 2–3 sentences (in business voice)
  about_why_us: string[];        // 3–5 bullets — what makes them different
  services: ServiceCopy[];       // one per service
  service_area_intro: string;    // 1–2 sentence intro for the service-area page
  contact_blurb: string;         // 1 sentence above the contact form
  meta_description: string;      // <=155 chars for <meta name="description">
  // Premium-template fields (used by templates/premium-trades/):
  cta_primary: string;           // 2–4 word primary CTA, e.g. "Get a Free Quote"
  cta_secondary: string;         // 2–4 word secondary CTA, e.g. "Call Us Now"
  social_proof_line: string;     // 1 short line, e.g. "Trusted by 200+ Austin homeowners"
  urgency_micro: string;         // 3–6 word reassurance, e.g. "Same-day calls answered"
}

interface CopyInput {
  business_name?: string;
  category?: string | null;
  city?: string | null;
  address?: string | null;
  reviews?: Array<unknown>;
  services_hints?: string[];
  service_areas_hints?: string[];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hero_tagline: { type: Type.STRING },
    hero_subhead: { type: Type.STRING },
    trust_strip: { type: Type.ARRAY, items: { type: Type.STRING } },
    about_paragraph: { type: Type.STRING },
    about_why_us: { type: Type.ARRAY, items: { type: Type.STRING } },
    services: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slug: { type: Type.STRING },
          name: { type: Type.STRING },
          short_description: { type: Type.STRING },
          detail_paragraph: { type: Type.STRING },
          bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["slug", "name", "short_description", "detail_paragraph", "bullets"],
      },
    },
    service_area_intro: { type: Type.STRING },
    contact_blurb: { type: Type.STRING },
    meta_description: { type: Type.STRING },
    cta_primary: { type: Type.STRING },
    cta_secondary: { type: Type.STRING },
    social_proof_line: { type: Type.STRING },
    urgency_micro: { type: Type.STRING },
  },
  required: [
    "hero_tagline",
    "hero_subhead",
    "trust_strip",
    "about_paragraph",
    "about_why_us",
    "services",
    "service_area_intro",
    "contact_blurb",
    "meta_description",
    "cta_primary",
    "cta_secondary",
    "social_proof_line",
    "urgency_micro",
  ],
};

export async function generateCopy(lead: CopyInput): Promise<SiteCopy> {
  const userPayload = {
    business_name: lead.business_name,
    category: lead.category,
    city: lead.city ?? cityFromAddress(lead.address ?? null),
    address: lead.address,
    top_reviews: (lead.reviews ?? []).slice(0, 5),
    services_hints: lead.services_hints ?? [],
    service_areas_hints: lead.service_areas_hints ?? [],
  };

  log.info({ business: lead.business_name }, "gemini.copy.request");

  const resp = await retry(
    () =>
      client().models.generateContent({
        model: env.GOOGLE_GENAI_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Write copy for the multi-page website for this business. " +
                  "Return JSON matching the schema.\n\n" +
                  JSON.stringify(userPayload, null, 2),
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7,
          // Multi-page copy (home + about + N services with bullets + areas
          // + contact + meta) regularly runs past 2048 tokens. Truncated
          // responses are invalid JSON and the parser crashes downstream.
          // 8192 still fits Gemini Flash's free tier; pick smaller only if
          // measured output stays under it.
          maxOutputTokens: 8192,
        },
      }),
    { maxAttempts: 3 },
  );

  const text = resp.text ?? "";
  let data: SiteCopy;
  try {
    data = JSON.parse(text);
  } catch {
    log.error({ text: text.slice(0, 500) }, "gemini.copy.bad_json");
    throw new Error("gemini returned non-JSON copy");
  }
  log.info({ business: lead.business_name, services: data.services.length }, "gemini.copy.ok");
  return data;
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}
