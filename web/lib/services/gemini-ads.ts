/**
 * gemini-ads.ts — Gemini reads a competitor's ad and writes the plan for OUR version for one client.
 *
 * Inputs:  the competitor ad (text, CTA, link, media kind, platforms) + the client's Brand Brain facts and products
 * Outputs: AdAnalysis — hook, angle, why it works, structure, a brief for our post, a video script, template suggestion
 * Used by: lib/ads/remake.ts
 *
 * The competitor's wording is never reused: the brief and script are written from the client's own facts, and the
 * post made from them still goes through grounding. One Flash call, fractions of a cent.
 */
import "@/lib/server-guard";
import { z } from "zod";
import { Type } from "@google/genai";
import type { Usage } from "@/lib/clients/cost";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import { renderFacts } from "@/lib/services/gemini-creative";
import { structuredCall } from "@/lib/services/gemini-brand";
import { TEMPLATE_KEYS, CTA_KINDS } from "@/lib/creatives/types";

export const AdAnalysisSchema = z.object({
  hook: z.string(),
  angle: z.string(),
  why_it_works: z.string(),
  structure: z.array(z.string()).min(1),
  tone: z.string(),
  offer_shape: z.string(),
  our_title: z.string(),
  our_brief: z.string(),
  template_key: z.enum(TEMPLATE_KEYS),
  cta_kind: z.enum(CTA_KINDS),
  video_script: z.array(z.object({ scene: z.number(), seconds: z.number(), visual: z.string(), on_screen_text: z.string(), voice_over: z.string() })),
  cautions: z.array(z.string()),
});
export type AdAnalysis = z.infer<typeof AdAnalysisSchema>;

const S = { type: Type.STRING };
const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hook: S,
    angle: S,
    why_it_works: S,
    structure: { type: Type.ARRAY, items: S },
    tone: S,
    offer_shape: S,
    our_title: S,
    our_brief: S,
    template_key: { type: Type.STRING, enum: [...TEMPLATE_KEYS] },
    cta_kind: { type: Type.STRING, enum: [...CTA_KINDS] },
    video_script: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { scene: { type: Type.INTEGER }, seconds: { type: Type.NUMBER }, visual: S, on_screen_text: S, voice_over: S },
        required: ["scene", "seconds", "visual", "on_screen_text", "voice_over"],
      },
    },
    cautions: { type: Type.ARRAY, items: S },
  },
  required: ["hook", "angle", "why_it_works", "structure", "tone", "offer_shape", "our_title", "our_brief", "template_key", "cta_kind", "video_script", "cautions"],
};

const SYSTEM = `You are a performance-ad strategist. You are shown ONE competitor ad (from the Meta Ad Library) and the Brand Brain of OUR client, a different local business.
Task: explain what makes the competitor ad work, then plan OUR OWN original ad for our client in the same spirit.
Rules (all mandatory):
- Never copy the competitor's sentences, slogans, prices, offers, numbers or claims. Describe the technique (hook type, structure, pacing, offer shape, CTA style), then rebuild it with OUR client's facts.
- our_brief: 2–5 sentences a copywriter can work from: the hook to use, the angle, which product/service from OUR facts, the CTA. Only facts listed under BRAND FACTS / PRODUCTS; if the competitor's offer (a discount, a free kit…) has no counterpart in our facts, say so in cautions and use what we do have.
- video_script: 4–7 scenes for a 15–30 s vertical video (Reel/Short). Each scene: seconds, what is on screen (use OUR client's real photos/products/logo), the on-screen text, a short voice-over line. For an image-only competitor ad still write a script (how this idea would play as video).
- template_key: product-hero (one product/service), offer (a deal or CTA-led), tip-quote (advice/education), review (a customer quote — only if BRAND FACTS has reviews).
- tone: 3–6 words. structure: the beats of the competitor ad in order (3–6 items).
- cautions: anything in the competitor ad we must NOT imitate (claims we can't make, comparisons, pricing, trademarks).`;

export async function analyzeCompetitorAd(input: {
  ad: { page_name: string | null; title: string | null; body: string | null; cta_text: string | null; link_description: string | null; media_kind: string; display_format: string | null; platforms: string[]; is_active: boolean | null; started_at: string | null };
  profile: BrandProfileData;
  products: ProductSnapshot[];
  platforms: string[];
}): Promise<{ output: AdAnalysis; usage: Usage }> {
  const a = input.ad;
  const prompt = `# COMPETITOR AD
Advertiser page: ${a.page_name ?? "(unknown)"}
Format: ${a.media_kind}${a.display_format ? ` (${a.display_format})` : ""}; platforms: ${a.platforms.join(", ") || "unknown"}; ${a.is_active ? "still running" : "stopped"}${a.started_at ? `, started ${a.started_at.slice(0, 10)}` : ""}
Headline: ${a.title ?? "(none)"}
Primary text:
${a.body ?? "(none)"}
Link description: ${a.link_description ?? "(none)"}
CTA button: ${a.cta_text ?? "(none)"}

# OUR CLIENT
Business: ${input.profile.business.name?.value ?? "(unnamed)"} (${input.profile.business.category?.value ?? "local business"})
Platforms for our version: ${input.platforms.join(", ")}

${renderFacts(input.profile, input.products)}`;
  return structuredCall<AdAnalysis>({ label: "ad_analysis", system: SYSTEM, prompt, responseSchema: SCHEMA, zod: AdAnalysisSchema });
}
