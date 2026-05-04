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
    "premium-hero"      — Aceternity-style: 5 animated brand-color radial
                          blobs, vertical glass-strip refraction, word-by-word
                          title reveal. Optional faint bg photo. Most
                          visually striking. Best for: high-trust
                          professional services (legal, financial,
                          consulting) with ≥50 reviews — reads as a
                          $50K agency site.
    "full-bleed-photo"  — cinematic full-width hero photo with text overlay.
                          Best for: boutiques, restaurants, real estate,
                          beauty/wellness, food, anything photogenic.
    "split-with-stats"  — split layout, copy + key stats on left, large
                          photo right. Best for: trust-heavy businesses with
                          high review counts (≥50) and broad service areas
                          — contractors with proof.
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

# Theme — Page-Level Identity (NEW)
Pick ONE value per field. Theme controls the page-wide vibe; combined with
variants this is what makes two sites in the same niche feel like distinct
brands instead of templates.

- background:
    "plain"                    — no extra layer; clean and minimal. Default.
                                 Best for: retail, restaurant, wellness with
                                 strong photo hero.
    "aurora-blobs"             — soft brand-color blobs fade in top of page.
                                 Subtle premium signal. Best for: salons,
                                 boutiques, luxury wellness.
    "animated-gradient-mesh"   — slow-shifting brand-color radial mesh covers
                                 the whole page bg. Most striking. Best for:
                                 creative pros (designers, photographers,
                                 architects) and high-trust services that
                                 want a "modern-tech" feel.

- button_style:
    "solid"          — current full-pill brand-bg. Default. Most niches.
    "shimmer"        — rotating conic-gradient border + accent glow. Premium
                       feel. Best for: high-trust pro services, luxury
                       wellness, real estate.
    "shining-sweep"  — diagonal white shine sweep on hover. Light, friendly.
                       Best for: trades, food, fitness, casual retail.

- font_pair:
    "editorial-serif"  — Fraunces (heading) + Inter (body). Default magazine
                         feel. Best for: boutique, food, beauty, vintage.
    "modern-sans"      — Space Grotesk (heading) + Inter (body). Bold,
                         contemporary. Best for: trades, fitness, tech,
                         home services where confidence > tradition.
    "classical-serif"  — Cormorant Garamond (heading) + Lato (body). Refined
                         editorial gravitas. Best for: legal, financial,
                         accountants, boutique law firms — anything where
                         clients expect "establishment".

Pick combos that compound the niche — e.g. legal = classical-serif font +
shimmer button + plain bg (not flashy gradients); creative agency = modern-
sans + animated-gradient-mesh + shining-sweep buttons; salon = editorial-
serif + aurora-blobs + solid buttons.

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

export interface AiTheme {
  background: "plain" | "aurora-blobs" | "animated-gradient-mesh";
  button_style: "solid" | "shimmer" | "shining-sweep";
  font_pair: "editorial-serif" | "modern-sans" | "classical-serif";
}

export interface AiVariants {
  hero:
    | "parallax-photos"
    | "animated-gradient"
    | "full-bleed-photo"
    | "split-with-stats"
    | "premium-hero";
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
  theme: AiTheme;
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
          enum: [
            "parallax-photos",
            "animated-gradient",
            "full-bleed-photo",
            "split-with-stats",
            "premium-hero",
          ],
        },
        services: { type: Type.STRING, enum: ["bento-grid", "photo-cards", "minimal-list"] },
        reviews: { type: Type.STRING, enum: ["marquee", "masonry-grid", "single-featured"] },
        trust: { type: Type.STRING, enum: ["animated-strip", "badge-grid"] },
        service_area: { type: Type.STRING, enum: ["styled-list"] },
        cta: { type: Type.STRING, enum: ["sticky-bar", "full-section"] },
      },
      required: ["hero", "services", "reviews", "trust", "service_area", "cta"],
    },
    theme: {
      type: Type.OBJECT,
      properties: {
        background: { type: Type.STRING, enum: ["plain", "aurora-blobs", "animated-gradient-mesh"] },
        button_style: { type: Type.STRING, enum: ["solid", "shimmer", "shining-sweep"] },
        font_pair: { type: Type.STRING, enum: ["editorial-serif", "modern-sans", "classical-serif"] },
      },
      required: ["background", "button_style", "font_pair"],
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
    "theme",
    "service_areas",
    "business_hours",
    "reviews",
    "copy",
  ],
};

// ── Multi-pass generation ──────────────────────────────────────────────────
// Originally a single Gemini call had to (a) decide variants/theme/palette,
// (b) write all copy across 5 pages, and (c) ground everything in the lead
// data — in one shot. Quality drifts because each concern competes for the
// model's attention budget. Two-pass:
//   Pass 1 — STRATEGY: decisions + positioning brief (variants, theme,
//            palette, hero angle, differentiation, service concepts).
//            Smaller schema, faster, cheaper, focused on judgment.
//   Pass 2 — COPY: generates full SiteCopy + reviews fallbacks + hours +
//            service areas, given pass 1's strategy as context. Each copy
//            field can lean into the established positioning instead of
//            being generic.
// Caller API unchanged: generateSiteData(lead) → AiSiteData.

const STRATEGY_SCHEMA = {
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
        "primary","primary_text","accent","surface","surface_alt","neutral_900","neutral_500",
      ],
    },
    variants: {
      type: Type.OBJECT,
      properties: {
        hero: {
          type: Type.STRING,
          enum: [
            "parallax-photos","animated-gradient","full-bleed-photo",
            "split-with-stats","premium-hero",
          ],
        },
        services: { type: Type.STRING, enum: ["bento-grid","photo-cards","minimal-list"] },
        reviews: { type: Type.STRING, enum: ["marquee","masonry-grid","single-featured"] },
        trust: { type: Type.STRING, enum: ["animated-strip","badge-grid"] },
        service_area: { type: Type.STRING, enum: ["styled-list"] },
        cta: { type: Type.STRING, enum: ["sticky-bar","full-section"] },
      },
      required: ["hero","services","reviews","trust","service_area","cta"],
    },
    theme: {
      type: Type.OBJECT,
      properties: {
        background: { type: Type.STRING, enum: ["plain","aurora-blobs","animated-gradient-mesh"] },
        button_style: { type: Type.STRING, enum: ["solid","shimmer","shining-sweep"] },
        font_pair: { type: Type.STRING, enum: ["editorial-serif","modern-sans","classical-serif"] },
      },
      required: ["background","button_style","font_pair"],
    },
    positioning_brief: {
      type: Type.OBJECT,
      properties: {
        vibe: { type: Type.STRING },
        hero_angle: { type: Type.STRING },
        differentiation: { type: Type.STRING },
        proof_pattern: { type: Type.STRING },
        service_concepts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              slug: { type: Type.STRING },
              name: { type: Type.STRING },
              angle: { type: Type.STRING },
            },
            required: ["slug","name","angle"],
          },
        },
      },
      required: ["vibe","hero_angle","differentiation","proof_pattern","service_concepts"],
    },
  },
  required: ["brand_color","palette","variants","theme","positioning_brief"],
};

interface PositioningBrief {
  vibe: string;
  hero_angle: string;
  differentiation: string;
  proof_pattern: string;
  service_concepts: Array<{ slug: string; name: string; angle: string }>;
}

interface StrategyOutput {
  brand_color: string;
  palette: AiPalette;
  variants: AiVariants;
  theme: AiTheme;
  positioning_brief: PositioningBrief;
}

const STRATEGY_PROMPT = `You are the art director and brand strategist for a
$2,000 hand-coded local-business website. Your ONLY job in this pass is to
make the strategic decisions that the copywriter will lean on next. No copy
fields here — those come in pass 2.

# Your output (STRATEGY_SCHEMA)
- brand_color + palette  — niche-aware (see Voice & Palette guide below)
- variants               — hero/services/reviews/trust/service_area/cta
- theme                  — background/button_style/font_pair
- positioning_brief:
    vibe                 — 5-10 words, the gut-feel of this brand
    hero_angle           — what's the page's central promise? (1 sentence)
    differentiation      — why this business specifically? (1 sentence,
                           must be grounded in supplied data — city,
                           reviews, category — not invented)
    proof_pattern        — which proof card to lean on? options: review-count,
                           years-in-business, family-owned, niche-credential,
                           local-roots
    service_concepts     — 3-4 services as { slug, name, angle }; angle is a
                           1-line POV the copywriter will expand from

# Niche-aware palette (pick by category + business name)
- Plumbers / HVAC / Electricians: deep blues + crisp whites + bright orange
- Landscaping / Roofing / Concrete / Construction: forest greens + browns
- Salons / Spas / Boutiques / Florists / Estate Sales / Vintage:
  soft pastels + muted elegance + charcoal text
- Professional services (lawyers, accountants, consultants, financial):
  deep navy + slate + gold/silver
- Food / cafes / restaurants: warm terracottas + creams + deep greens
- Real estate / property: refined navy/charcoal + brass or sage

# Variant + theme menu
__MENU__

# Pick combos that compound the niche
- Legal / financial: classical-serif + shimmer + plain. Restraint signals.
- Salon / boutique: editorial-serif + solid + aurora-blobs. Soft luxury.
- Trades / fitness: modern-sans + shining-sweep + aurora-blobs.
  Bold confidence.
- Real estate / creative pro: classical-serif or modern-sans +
  animated-gradient-mesh + shimmer. Modern editorial.

Return JSON matching STRATEGY_SCHEMA. No commentary.`.replace(
  "__MENU__",
  // Reuse the variant + theme menu from the main system prompt — single
  // source of truth for "what's available".
  SYSTEM_PROMPT.split("# Layout Variants")[1]?.split("# Graceful Fallbacks")[0] ?? "",
);

const COPY_ONLY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
      required: ["mon","tue","wed","thu","fri","sat","sun"],
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
        required: ["author","rating","text"],
      },
    },
    copy: COPY_SCHEMA,
  },
  required: ["service_areas","business_hours","reviews","copy"],
};

const COPY_PROMPT = `You are the lead copywriter on a $2,000 hand-coded
website. The art director has already picked variants, theme, palette, and
written a positioning brief. Your job: generate ALL copy that lives inside
the positioning. Every line should reinforce the hero_angle and
differentiation the brief established — never blander, never generic.

# Voice rules (same as ever)
- Warm, confident, plain English. Like a helpful neighbor.
- NEVER buzzwords ("synergy", "cutting-edge", "best-in-class",
  "industry-leading", "next-generation", "world-class").
- CRITICAL: weave the specific city / neighborhood / review_count into copy
  where supplied. Examples in the system prompt apply.

# Use the positioning brief
- hero_tagline / hero_subhead must echo the hero_angle.
- about_paragraph must convey the differentiation.
- about_why_us bullets should mirror the proof_pattern.
- services array should expand each service_concept's angle into:
    short_description (1 sentence)
    detail_paragraph  (2-3 sentences explaining the value)
    bullets           (3-4 specific deliverables)
  Use the brief's slug + name verbatim.

# Other copy fields
- trust_strip: 4 short trust signals
- service_area_intro: 1-2 sentences mentioning service radius
- contact_blurb: 1 sentence inviting a call/quote
- meta_description: under 155 chars, SEO for niche + city
- cta_primary: 2-4 words, action-first
- cta_secondary: 2-4 words, lower commitment
- urgency_micro: 3-6 words, reassurance not pressure
- social_proof_line: 1 short line tied to proof_pattern

# Fallbacks
- No real reviews → fabricate 3 realistic, generalized reviews tied to the
  service_concepts. Vary author names, ratings stay 5.
- review_count missing/0 → social_proof_line uses
  "Proudly serving our local community" or similar — never invent a number.
- review_count >= 25 → "Trusted by N+ {city} {homeowners|customers}".
- review_count < 25 (when supplied) → humble + true ("Locally owned in {city}").
- No business_hours → default Mon-Fri 8:00am – 5:00pm, Sat & Sun closed.
- No address → general regional terms ("your trusted local experts").

Return JSON matching the schema EXACTLY. No commentary.`;

async function generateStrategy(lead: CopyInput): Promise<StrategyOutput> {
  const userPayload = {
    business_name: lead.business_name,
    category: lead.category,
    city: lead.city ?? cityFromAddress(lead.address ?? null),
    address: lead.address,
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    top_reviews: (lead.reviews ?? []).slice(0, 5),
    services_hints: lead.services_hints ?? [],
  };

  log.info({ business: lead.business_name }, "gemini.strategy.request");

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
                  "Make the strategic decisions for this business and " +
                  "return STRATEGY_SCHEMA JSON.\n\n" +
                  JSON.stringify(userPayload, null, 2),
              },
            ],
          },
        ],
        config: {
          systemInstruction: STRATEGY_PROMPT,
          responseMimeType: "application/json",
          responseSchema: STRATEGY_SCHEMA,
          temperature: 0.6,  // tighter — judgment over flair
          maxOutputTokens: 2048,
        },
      }),
    { maxAttempts: 3 },
  );

  const text = resp.text ?? "";
  try {
    return JSON.parse(text) as StrategyOutput;
  } catch {
    log.error({ text: text.slice(0, 500) }, "gemini.strategy.bad_json");
    throw new Error("gemini returned non-JSON strategy");
  }
}

async function generateCopyFromStrategy(
  lead: CopyInput,
  strategy: StrategyOutput,
): Promise<{
  service_areas: string[];
  business_hours: AiBusinessHours;
  reviews: AiReviewItem[];
  copy: SiteCopy;
}> {
  const userPayload = {
    business_name: lead.business_name,
    category: lead.category,
    city: lead.city ?? cityFromAddress(lead.address ?? null),
    address: lead.address,
    rating: lead.rating ?? null,
    review_count: lead.review_count ?? null,
    top_reviews: (lead.reviews ?? []).slice(0, 5),
    business_hours: lead.business_hours ?? null,
    service_areas_hints: lead.service_areas_hints ?? [],
    // Pass 1's output flows into pass 2 as context
    positioning_brief: strategy.positioning_brief,
    chosen_variants: strategy.variants,
    chosen_theme: strategy.theme,
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
                  "Generate copy + supporting data, leaning into the " +
                  "positioning_brief.\n\n" +
                  JSON.stringify(userPayload, null, 2),
              },
            ],
          },
        ],
        config: {
          systemInstruction: COPY_PROMPT,
          responseMimeType: "application/json",
          responseSchema: COPY_ONLY_SCHEMA,
          temperature: 0.75,  // looser — flair on the copy itself
          maxOutputTokens: 8192,
        },
      }),
    { maxAttempts: 3 },
  );

  const text = resp.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    log.error({ text: text.slice(0, 500) }, "gemini.copy.bad_json");
    throw new Error("gemini returned non-JSON copy");
  }
}

export async function generateSiteData(lead: CopyInput): Promise<AiSiteData> {
  const strategy = await generateStrategy(lead);
  const copyData = await generateCopyFromStrategy(lead, strategy);

  log.info(
    {
      business: lead.business_name,
      hero_variant: strategy.variants.hero,
      services_variant: strategy.variants.services,
      services: copyData.copy?.services?.length,
      vibe: strategy.positioning_brief.vibe,
    },
    "gemini.site.ok",
  );

  return {
    brand_color: strategy.brand_color,
    palette: strategy.palette,
    variants: strategy.variants,
    theme: strategy.theme,
    service_areas: copyData.service_areas,
    business_hours: copyData.business_hours,
    reviews: copyData.reviews,
    copy: copyData.copy,
  };
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}
