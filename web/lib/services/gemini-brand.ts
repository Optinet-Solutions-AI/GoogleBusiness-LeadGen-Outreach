/**
 * gemini-brand.ts — Gemini calls for Brand Brain: sourced fact extraction and brand-voice synthesis.
 *
 * Inputs:  ExtractionInput (intake / Google Maps / crawled pages / assets); voice passages + intake
 * Outputs: zod-validated ExtractionOutput / VoiceOutput + token Usage
 * Used by: the Brand Brain extraction job (Task 8)
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { client } from "@/lib/services/gemini";
import type { Usage } from "@/lib/clients/cost";
import type { IntakeForm } from "@/lib/clients/sources";
import { renderUserPrompt, type ExtractionInput } from "@/lib/clients/extract/prompt";
import {
  BRAND_FACTS_SCHEMA,
  ExtractionOutput,
  FACT_PATHS,
  VOICE_SCHEMA,
  VoiceOutput,
} from "@/lib/clients/extract/schema";

const log = getLogger("gemini-brand");

const FACTS_SYSTEM_PROMPT = `You extract a sourced business profile for a local business from the material provided.
Return JSON matching the schema: a flat "facts" list and a "products" list.

Rules (all mandatory):
- Every fact MUST cite its "source": the page id from a "## PAGE <id>" heading, or "operator" (the operator intake) or "google_maps".
- Copy the supporting "quote" VERBATIM from that source (exact characters, no paraphrasing). Use null only for operator/google_maps facts that have no quotable sentence.
- If a fact is not supported by the material, OMIT it. Never guess and never fill a path just to fill it.
- NEVER invent prices, discounts, awards, testimonials, certifications, owner names or years in business. Only state what the sources say.
- Operator intake is authoritative and wins over website text on conflicts.
- At most 10 products; each with its own source and verbatim quote. Put image asset ids from the ASSETS section in image_asset_ids only when the asset clearly shows that product, otherwise use [].
- "path" MUST be exactly one of the allowed paths below. Do not fill voice.* (a separate step does that).
- "value" is always a STRING. For paths ending in [] add one fact per item. For audiences[] and ctas[] the value is a JSON-encoded STRING:
  audiences[] -> {"name":"","description":"","pains":[],"wants":[]}
  ctas[] -> {"text":"","kind":"call|book|visit|message|website"}
- business.hours.* values look like "8am-5pm" or "Closed".

Allowed paths:
${FACT_PATHS.map((p) => `- ${p}`).join("\n")}`;

const VOICE_SYSTEM_PROMPT = `You describe a local business's brand voice for social media writers.
Use ONLY the passages and operator intake provided; do not invent traits the material does not show.
Return: tone (3-5 short adjectives), style_notes (2-3 sentences on how the business writes), do (3-6 concrete writing rules),
dont (3-6 things to avoid, including anything the operator says never to claim), sample_lines (3-5 short example social lines in this voice
that make no unsupported claims about prices, discounts, awards, testimonials or years in business).`;

function usageOf(resp: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }): Usage {
  return {
    prompt_tokens: resp.usageMetadata?.promptTokenCount ?? 0,
    completion_tokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
    model: env.GOOGLE_GENAI_MODEL,
  };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    model: b.model,
  };
}

/** One structured call; on parse/zod failure retries once with the issues appended, then throws. */
async function structuredCall<T>(opts: {
  label: string;
  system: string;
  prompt: string;
  responseSchema: unknown;
  zod: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } };
}): Promise<{ output: T; usage: Usage }> {
  let prompt = opts.prompt;
  let total: Usage = { prompt_tokens: 0, completion_tokens: 0, model: env.GOOGLE_GENAI_MODEL };
  let lastIssue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    log.info({ label: opts.label, attempt }, "gemini_brand.request");
    const resp = await retry(() =>
      client().models.generateContent({
        model: env.GOOGLE_GENAI_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseSchema: opts.responseSchema as never,
          temperature: 0.2,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    );
    total = addUsage(total, usageOf(resp));
    let json: unknown;
    try {
      json = JSON.parse(resp.text ?? "");
    } catch (err) {
      lastIssue = `Response was not valid JSON: ${String(err).slice(0, 200)}`;
      log.warn({ label: opts.label, attempt, issue: lastIssue }, "gemini_brand.invalid");
      prompt = `${opts.prompt}\n\n# PREVIOUS ATTEMPT FAILED\n${lastIssue}\nReturn complete, valid JSON.`;
      continue;
    }
    const parsed = opts.zod.safeParse(json);
    if (parsed.success) {
      log.info({ label: opts.label, usage: total }, "gemini_brand.ok");
      return { output: parsed.data, usage: total };
    }
    lastIssue = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    log.warn({ label: opts.label, attempt, issue: lastIssue }, "gemini_brand.invalid");
    prompt = `${opts.prompt}\n\n# PREVIOUS ATTEMPT FAILED VALIDATION\n${lastIssue}\nFix these issues and return the full JSON again.`;
  }
  throw new Error(`gemini_brand.${opts.label}.failed: ${lastIssue}`);
}

export async function extractBrandFacts(input: ExtractionInput): Promise<{ output: ExtractionOutput; usage: Usage }> {
  return structuredCall<ExtractionOutput>({
    label: "facts",
    system: FACTS_SYSTEM_PROMPT,
    prompt: `Extract the sourced brand facts and products.\n\n${renderUserPrompt(input)}`,
    responseSchema: BRAND_FACTS_SCHEMA,
    zod: ExtractionOutput,
  });
}

export async function extractVoice(input: {
  passages: string[];
  intake: IntakeForm | null;
  category: string | null;
}): Promise<{ output: VoiceOutput; usage: Usage }> {
  const parts: string[] = [];
  if (input.category) parts.push(`Business category: ${input.category}`);
  if (input.intake) {
    parts.push(
      `# OPERATOR INTAKE (authoritative)\nTone: ${input.intake.tone.join(", ")}\nTone note: ${input.intake.tone_note}\nAlways mention: ${input.intake.always_mention}\nNever claim: ${input.intake.never_claim}`,
    );
  }
  if (input.passages.length) parts.push(`# PASSAGES\n${input.passages.map((p, i) => `[${i + 1}] ${p}`).join("\n\n")}`);
  return structuredCall<VoiceOutput>({
    label: "voice",
    system: VOICE_SYSTEM_PROMPT,
    prompt: `Describe this business's brand voice.\n\n${parts.join("\n\n")}`,
    responseSchema: VOICE_SCHEMA,
    zod: VoiceOutput,
  });
}
