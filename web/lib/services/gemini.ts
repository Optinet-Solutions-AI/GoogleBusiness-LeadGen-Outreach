/**
 * gemini.ts — Google Gemini API client. Generates the per-business data.json
 * payload that drives the Astro template (copy + palette + variants + fallbacks).
 *
 * Inputs:  lead (name, category, address, rating, review_count, reviews, hints)
 * Outputs: AiSiteData = brand_color, palette, variants, service_areas,
 *          business_hours, reviews fallback, full SiteCopy
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

const SYSTEM_PROMPT = `You are an elite full-stack web developer, premium UI/UX
"Art Director", and direct-response copywriter generating the data.json that
drives a headless Astro + Tailwind website. The site uses a "Mega-Template"
architecture where layout, palette, and content are driven dynamically by
your output.

# Goal
Make this output so highly personalized and visually striking that the business
owner believes a human spent 10 hours custom-coding a $2,000 website
specifically for them.

# Voice & Copy (Hyper-Personalized)
- Warm, confident, plain English. Write like a helpful neighbor.
- NEVER use corporate buzzwords ("synergy", "cutting-edge", "world-class",
  "best-in-class", "solutions", "industry-leading", "next-generation").
- CRITICAL: weave the specific city / neighborhood / review_count into copy
  whenever they are present.
    Bad:  "We are the best landscapers in town."
    Good: "Keeping South Austin green since 2015. See why 142 of your neighbors
           rated us 5 stars."
- Use ONLY facts grounded in supplied data. NEVER invent licenses, awards,
  years in business, or affiliations.

# Design Tokens & Palette (niche-aware — pick by category AND business name)
- Plumbers / HVAC / Electricians: trustworthy deep blues, crisp whites,
  bright orange or red accents.
- Landscaping / Roofing / Concrete / Construction: earthy forest greens,
  deep browns, warm accents.
- Salons / Spas / Boutiques / Florists / Estate Sales / Vintage / Home Goods:
  soft pastels, muted elegance, charcoal text.
- Professional services (lawyers, accountants, consultants, financial):
  deep navy, slate gray, gold or silver accents.
- Food & beverage / cafes / restaurants: warm terracottas, creams, deep greens.
- Real estate / property: refined navy/charcoal with brass or sage accents.

Return the FULL palette: primary, primary_text, accent, surface, surface_alt,
neutral_900, neutral_500. primary_text MUST contrast cleanly with primary
(white on dark primary, near-black on light primary).

# Layout Variants — Choose ONE per category from the available bank
You are the art director. Pick variants based on the business's vibe, photo
quality, review count, and service type. Do not invent values outside these:

- hero:
    "full-bleed-photo"  — cinematic full-width hero photo with text overlay.
                          Best for: boutiques, restaurants, real estate,
                          beauty/wellness, food, anything photogenic.
    "split-with-stats"  — split layout, copy + key stats on left, large
                          photo right. Best for: trust-heavy businesses with
                          high review counts (≥50) and broad service areas
                          — contractors, professional services with proof.
    "parallax-photos"   — multi-photo collage, drifts on scroll. Best for:
                          home services / trades with ≥6 strong photos.
    "animated-gradient" — no photo, animated mesh gradient + text. Best for:
                          sleek professional services where imagery would
                          feel stocky (accountants, lawyers, consultants).

- services:
    "photo-cards"  — equal-weight cards, each with a distinct photo. Best
                     for: visually-driven niches (food, beauty, estate sales,
                     home goods) where each service has its own look.
    "minimal-list" — refined numbered editorial list. Best for: professional
                     services (lawyers, accountants, consultants) where
                     photos would feel out of place.
    "bento-grid"   — asymmetric grid with one feature card + uniform smaller
                     cards. Best for: home services / trades with one clear
                     "hero" service.

- reviews:
    "masonry-grid"     — Pinterest-style staggered wall. Best when ≥6 real
                         reviews exist — volume is the message.
    "single-featured"  — one large pull-quote + 2 supporting cards. Best when
                         1-3 strong reviews available — leans into quality.
    "marquee"          — horizontal scrolling marquee of cards. Best when
                         3-6 reviews — busier visual without claiming volume.

- trust:
    "badge-grid"      — 4 trust signals as outlined cards in a grid. Best
                        for trust-heavy niches (medical, financial, legal,
                        contractors with credentials).
    "animated-strip"  — single row of pill-style trust signals. Best for
                        casual home services / retail / food — calmer.

- service_area: "styled-list" (only variant — uses real Google Maps embed)

- cta:
    "full-section"  — dramatic full-width brand-color conversion section.
                      Best for high-intent niches (emergency, contractors,
                      real estate) where a punchy bottom-of-page CTA matters.
    "sticky-bar"    — scroll-triggered floating bar (always rendered too).
                      Pick this as the cta variant for low-key niches like
                      boutiques / florists where a soft nudge is enough.

# Graceful Fallbacks (never fail — fill gaps with sensible defaults)
- No city/address → use general regional terms ("your trusted local experts").
  Do NOT invent a city.
- No reviews provided → generate 3 highly realistic, generalized reviews
  highlighting the core services. Vary author names, ratings stay 5.
- review_count missing or 0 → social_proof_line MUST NOT invent a number.
  Write "Proudly serving our local community" or "Trusted by homeowners
  across the region".
- review_count >= 25 (when provided) → social_proof_line:
  "Trusted by N+ {city} {homeowners|customers}".
- review_count < 25 (when provided) → humble + true ("Locally owned in {city}").
- No business hours → default Mon–Fri 8:00 AM – 5:00 PM, Sat & Sun Closed.

# Specific copy rules
- hero_tagline: 6–12 words. Punchy and local. Mention city or specific niche
  when possible.
- hero_subhead: 1 supporting sentence mentioning city or years in business
  when known.
- about_paragraph: 2–3 sentences. Warm business voice. Mention specific
  location when known.
- about_why_us: 4 short benefit phrases.
- trust_strip: 4 short trust signals (e.g. "Licensed & Insured",
  "Family-Owned Since 2010", "Same-Day Service").
- cta_primary: 2–4 words, action-first ("Get a Free Quote", "Book a Visit").
- cta_secondary: 2–4 words, lower commitment ("Call Us Now", "See Reviews").
- urgency_micro: 3–6 words, reassurance not pressure ("Same-day calls answered",
  "Free quotes, no pressure").
- meta_description: under 155 characters, SEO-optimized for niche + city.

# Services
Infer 3 to 4 core services from category + business name. For each:
- short_description: 1 sentence
- detail_paragraph: 2–3 sentences explaining the value
- bullets: 3–4 specific deliverables

# Output
Return JSON matching the response schema EXACTLY. No markdown code blocks.
No commentary. Every field is required.`;

export interface ServiceCopy {
  slug: string;
  name: string;
  short_description: string;
  detail_paragraph: string;
  bullets: string[];
}

export interface SiteCopy {
  hero_tagline: string;
  hero_subhead: string;
  trust_strip: string[];
  about_paragraph: string;
  about_why_us: string[];
  services: ServiceCopy[];
  service_area_intro: string;
  contact_blurb: string;
  meta_description: string;
  cta_primary: string;
  cta_secondary: string;
  social_proof_line: string;
  urgency_micro: string;
}

export interface AiPalette {
  primary: string;
  primary_text: string;
  accent: string;
  surface: string;
  surface_alt: string;
  neutral_900: string;
  neutral_500: string;
}

export interface AiVariants {
  hero:
    | "parallax-photos"
    | "animated-gradient"
    | "full-bleed-photo"
    | "split-with-stats";
  services: "bento-grid" | "photo-cards" | "minimal-list";
  reviews: "marquee" | "masonry-grid" | "single-featured";
  trust: "animated-strip" | "badge-grid";
  service_area: "styled-list";
  cta: "sticky-bar" | "full-section";
}

export interface AiReviewItem {
  author: string;
  rating: number;
  text: string;
}

export interface AiBusinessHours {
  mon: string;
  tue: string;
  wed: string;
  thu: string;
  fri: string;
  sat: string;
  sun: string;
}

export interface AiSiteData {
  brand_color: string;
  palette: AiPalette;
  variants: AiVariants;
  service_areas: string[];
  business_hours: AiBusinessHours;
  reviews: AiReviewItem[];
  copy: SiteCopy;
}

interface CopyInput {
  business_name?: string;
  category?: string | null;
  city?: string | null;
  address?: string | null;
  rating?: number | null;
  review_count?: number | null;
  reviews?: Array<unknown>;
  business_hours?: Record<string, string> | null;
  services_hints?: string[];
  service_areas_hints?: string[];
}

const HEX = { type: Type.STRING };

const SERVICE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    slug: { type: Type.STRING },
    name: { type: Type.STRING },
    short_description: { type: Type.STRING },
    detail_paragraph: { type: Type.STRING },
    bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["slug", "name", "short_description", "detail_paragraph", "bullets"],
};

const COPY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hero_tagline: { type: Type.STRING },
    hero_subhead: { type: Type.STRING },
    trust_strip: { type: Type.ARRAY, items: { type: Type.STRING } },
    about_paragraph: { type: Type.STRING },
    about_why_us: { type: Type.ARRAY, items: { type: Type.STRING } },
    services: { type: Type.ARRAY, items: SERVICE_SCHEMA },
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

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    brand_color: HEX,
    palette: {
      type: Type.OBJECT,
      properties: {
        primary: HEX,
        primary_text: HEX,
        accent: HEX,
        surface: HEX,
        surface_alt: HEX,
        neutral_900: HEX,
        neutral_500: HEX,
      },
      required: [
        "primary",
        "primary_text",
        "accent",
        "surface",
        "surface_alt",
        "neutral_900",
        "neutral_500",
      ],
    },
    variants: {
      type: Type.OBJECT,
      properties: {
        hero: {
          type: Type.STRING,
          enum: ["parallax-photos", "animated-gradient", "full-bleed-photo", "split-with-stats"],
        },
        services: { type: Type.STRING, enum: ["bento-grid", "photo-cards", "minimal-list"] },
        reviews: { type: Type.STRING, enum: ["marquee", "masonry-grid", "single-featured"] },
        trust: { type: Type.STRING, enum: ["animated-strip", "badge-grid"] },
        service_area: { type: Type.STRING, enum: ["styled-list"] },
        cta: { type: Type.STRING, enum: ["sticky-bar", "full-section"] },
      },
      required: ["hero", "services", "reviews", "trust", "service_area", "cta"],
    },
    service_areas: { type: Type.ARRAY, items: { type: Type.STRING } },
    business_hours: {
      type: Type.OBJECT,
      properties: {
        mon: { type: Type.STRING },
        tue: { type: Type.STRING },
        wed: { type: Type.STRING },
        thu: { type: Type.STRING },
        fri: { type: Type.STRING },
        sat: { type: Type.STRING },
        sun: { type: Type.STRING },
      },
      required: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
    reviews: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          author: { type: Type.STRING },
          rating: { type: Type.NUMBER },
          text: { type: Type.STRING },
        },
        required: ["author", "rating", "text"],
      },
    },
    copy: COPY_SCHEMA,
  },
  required: [
    "brand_color",
    "palette",
    "variants",
    "service_areas",
    "business_hours",
    "reviews",
    "copy",
  ],
};

export async function generateSiteData(lead: CopyInput): Promise<AiSiteData> {
  const userPayload = {
    business_name: lead.business_name,
    category: lead.category,
    city: lead.city ?? cityFromAddress(lead.address ?? null),
    address: lead.address,
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    top_reviews: (lead.reviews ?? []).slice(0, 5),
    business_hours: lead.business_hours ?? null,
    services_hints: lead.services_hints ?? [],
    service_areas_hints: lead.service_areas_hints ?? [],
  };

  log.info({ business: lead.business_name }, "gemini.site.request");

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
                  "Generate the data.json for this business. Return JSON " +
                  "matching the schema exactly. Apply graceful fallbacks " +
                  "where data is missing.\n\n" +
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
          // Full data.json (palette + variants + fallbacks + multi-page copy
          // with N services + bullets) regularly approaches but stays under
          // 8192. Truncated responses are invalid JSON and crash downstream.
          maxOutputTokens: 8192,
        },
      }),
    { maxAttempts: 3 },
  );

  const text = resp.text ?? "";
  let data: AiSiteData;
  try {
    data = JSON.parse(text);
  } catch {
    log.error({ text: text.slice(0, 500) }, "gemini.site.bad_json");
    throw new Error("gemini returned non-JSON site data");
  }
  log.info(
    {
      business: lead.business_name,
      services: data.copy?.services?.length,
      hero_variant: data.variants?.hero,
    },
    "gemini.site.ok",
  );
  return data;
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}
