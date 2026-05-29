/**
 * call-script.ts — Generate a per-lead, per-offer phone script via Gemini.
 *
 * Inputs:  lead facts + the offer to pitch (build_website | improve_website | voice_agent)
 * Outputs: CallScript { opener, value_prop, objections[], cta }
 * Used by: lib/pipeline/stage-5-call.ts
 *
 * A human (or a future voice agent) reads this script on the call. Free-tier
 * Gemini Flash, same client pattern + retry-on-bad-JSON as gemini.ts.
 *
 * Pricing: Gemini 2.5 Flash free tier ≈ 1,500 req/day. ~$0 for the pilot.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../config";
import { getLogger } from "../logger";
import type { Offer } from "../offers";
import { OFFER_LABEL } from "../offers";

const log = getLogger("call-script");

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  if (!env.GOOGLE_GENAI_API_KEY) throw new Error("GOOGLE_GENAI_API_KEY missing");
  _client = new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY });
  return _client;
}

export interface ObjectionTurn {
  objection: string;
  response: string;
}

export interface CallScript {
  /** Offer this script pitches — echoed back for storage/snapshotting. */
  offer: Offer;
  /** First 1-2 sentences: who's calling + why. Warm, local, no buzzwords. */
  opener: string;
  /** The core pitch, 2-4 sentences grounded in the business's real facts. */
  value_prop: string;
  /** 3-4 likely objections + a short rebuttal each. */
  objections: ObjectionTurn[];
  /** The ask: book a 10-min call / look at the demo link / etc. */
  cta: string;
}

export interface CallScriptLead {
  business_name: string;
  category?: string | null;
  address?: string | null;
  rating?: number | null;
  review_count?: number | null;
  /** Demo site URL when one exists (build/improve offers reference it). */
  demo_url?: string | null;
  /** Audit issue codes — let the improve pitch name the actual problems. */
  website_issues?: string[] | null;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    opener: { type: Type.STRING },
    value_prop: { type: Type.STRING },
    objections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          objection: { type: Type.STRING },
          response: { type: Type.STRING },
        },
        required: ["objection", "response"],
      },
    },
    cta: { type: Type.STRING },
  },
  required: ["opener", "value_prop", "objections", "cta"],
} as const;

const OFFER_BRIEF: Record<Offer, string> = {
  build_website:
    "This business has NO website. Pitch: we already built them a free demo " +
    "site (reference the demo_url) — modern, mobile, ready to go live. The " +
    "hook is that it already exists and they can see themselves on it today.",
  improve_website:
    "This business has an OLD/broken website. Pitch: we rebuilt a modern " +
    "version (reference the demo_url) that fixes the specific problems found " +
    "(use website_issues — e.g. not mobile-friendly, no HTTPS, slow, dated). " +
    "Be specific and factual about what's wrong; don't insult, just contrast.",
  voice_agent:
    "Pitch an AI voice receptionist that answers every call 24/7, books jobs, " +
    "and never sends a customer to voicemail. The hook: missed calls are lost " +
    "revenue for a local business; this catches the ones they miss after hours " +
    "or while on a job.",
};

const SYSTEM_PROMPT = `You are a top cold-call closer for a local-business
web + AI agency. Write a SHORT phone script a human will read aloud to a
small-business owner. Rules:
- Warm, confident, plain spoken English. Sound like a neighbor, not a
  telemarketer. Short sentences — this is spoken, not written.
- NEVER use buzzwords (synergy, cutting-edge, world-class, solutions,
  leverage, best-in-class).
- Ground everything in the supplied facts (city, category, rating,
  review_count, the website issues). Never invent awards, years, or numbers.
- The opener must respect their time: name who's calling and why in one
  breath, then ask one permission question.
- Objections: anticipate the 3-4 a busy owner actually says ("not
  interested", "too expensive", "I already have a guy", "send me an email")
  and give a one-line, non-pushy rebuttal each.
- CTA: low-friction. Aim for a 10-minute follow-up or "can I text you the
  link?" — not a hard close on the first call.
Return JSON matching the schema EXACTLY. No markdown, no commentary.`;

/**
 * Generate a phone script for one lead + offer. Retries on bad JSON (the
 * schema is small, so 2 attempts is plenty).
 */
export async function generateCallScript(
  lead: CallScriptLead,
  offer: Offer,
): Promise<CallScript> {
  const payload = {
    offer: OFFER_LABEL[offer],
    offer_brief: OFFER_BRIEF[offer],
    business_name: lead.business_name,
    category: lead.category ?? null,
    city: cityFromAddress(lead.address ?? null),
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    demo_url: lead.demo_url ?? null,
    website_issues: lead.website_issues ?? [],
  };

  log.info({ business: lead.business_name, offer }, "call_script.request");

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await client().models.generateContent({
        model: env.GOOGLE_GENAI_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Write the phone script for this business and offer.\n\n" +
                  JSON.stringify(payload, null, 2),
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      });
      const text = resp.text ?? "";
      const parsed = JSON.parse(text) as Omit<CallScript, "offer">;
      return { offer, ...parsed };
    } catch (err) {
      lastError = err;
      log.warn({ attempt, err: String(err).slice(0, 200) }, "call_script.retry");
    }
  }
  throw new Error(`call_script.failed after 2 attempts: ${String(lastError)}`);
}

/** Render a script to a plain-text block for storage / display. */
export function renderScriptText(script: CallScript): string {
  const lines = [
    `OFFER: ${OFFER_LABEL[script.offer]}`,
    "",
    `OPENER: ${script.opener}`,
    "",
    `PITCH: ${script.value_prop}`,
    "",
    "OBJECTIONS:",
    ...script.objections.map((o) => `  • "${o.objection}" → ${o.response}`),
    "",
    `CTA: ${script.cta}`,
  ];
  return lines.join("\n");
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? null);
}
