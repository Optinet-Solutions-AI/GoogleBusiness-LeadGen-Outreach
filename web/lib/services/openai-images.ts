/**
 * openai-images.ts — OpenAI Images API client for abstract post backgrounds, plus the pure prompt builder.
 *
 * Inputs:  prompt + size + quality; brand category/tone/colours + template key (backgroundPrompt)
 * Outputs: PNG Buffer + model + USD cost; prompt string
 * Used by: creative generation pipeline (backgrounds for offer / tip-quote templates)
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import type { TemplateKey } from "@/lib/creatives/types";

const log = getLogger("openai-images");

export function isOpenAiConfigured(): boolean {
  return env.OPENAI_API_KEY.trim().length > 0;
}

export const NEGATIVE_LIST = "no text, no letters, no logos, no faces, no product packaging, no watermarks";

/** Bucket a hex colour into a plain colour word ("neutral" for greys / unparsable input). */
export function colourWord(hex: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12 || max < 0.12) return "neutral";
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 340) return "red";
  if (hue < 45) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 260) return "blue";
  return "purple";
}

function sceneFor(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (/hvac|heating|cooling|air condition/.test(c)) return "a clean, modern home interior with cool air and a warm glow";
  if (/restaurant|cafe|coffee|bakery|bar\b|food|pizza/.test(c)) return "a warm kitchen with soft glowing bokeh lights";
  if (/plumb/.test(c)) return "a bright, clean modern bathroom with soft light on water and tile";
  if (/electric/.test(c)) return "a softly lit modern home interior with a warm lamp glow";
  if (/roof|construction|contractor|landscap|lawn/.test(c)) return "a sunlit residential street and garden at golden hour";
  if (/dent|medical|clinic|chiropract|health/.test(c)) return "a calm, bright clinic interior with soft natural light";
  if (/salon|spa|beauty|barber/.test(c)) return "a serene, softly lit studio interior with gentle shadows";
  return "a calm, softly lit modern interior";
}

/** Abstract soft-focus background prompt for the trade; colours from the brand hexes; fixed negative list. */
export function backgroundPrompt(
  brand: { category: string | null; tone: string[]; colors: { primary: string | null; accent: string | null } },
  templateKey: TemplateKey,
): string {
  const words = [...new Set([colourWord(brand.colors.primary), colourWord(brand.colors.accent)].filter((w): w is string => !!w))];
  const palette = words.length ? `a ${words.join(" and ")} colour palette` : "a restrained colour palette";
  const mood = brand.tone.length ? `Mood: ${brand.tone.slice(0, 3).join(", ")}.` : "";
  const category = brand.category ? ` for a ${brand.category} business` : "";
  const layout =
    templateKey === "tip-quote"
      ? "Keep the centre calm and low-contrast so large text can sit on top."
      : "Keep the lower half calm and low-contrast so text can sit on top.";
  return `An abstract, soft-focus background scene${category}: ${sceneFor(brand.category)}. Use ${palette}. ${mood} Heavily blurred, shallow depth of field, gentle gradients, no sharp detail. ${layout} Square-safe composition with no focal subject. ${NEGATIVE_LIST}.`.replace(/\s+/g, " ");
}

type ImagesResponse = { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };

async function post(body: Record<string, unknown>): Promise<{ status: number; json: ImagesResponse }> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as ImagesResponse;
  return { status: res.status, json };
}

/** One image; no retry (a retried paid call could double-charge). Throws with the API message on non-2xx. */
export async function generateBackground(input: {
  prompt: string;
  size: "1024x1024" | "1024x1536";
  quality: "low" | "medium" | "high";
}): Promise<{ png: Buffer; model: string; usd: number }> {
  if (!isOpenAiConfigured()) throw new Error("openai_not_configured");
  const model = env.OPENAI_IMAGE_MODEL;
  const base = { model, prompt: input.prompt, size: input.size, quality: input.quality, n: 1 };
  log.info({ model, size: input.size, quality: input.quality }, "openai_images.request");
  let r = await post({ ...base, output_format: "png" });
  if (r.status === 400 && /output_format/i.test(r.json.error?.message ?? "")) {
    log.warn({ model }, "openai_images.output_format_rejected");
    r = await post(base);
  }
  if (r.status < 200 || r.status >= 300) {
    const msg = r.json.error?.message ?? "unknown error";
    log.error({ status: r.status, msg }, "openai_images.failed");
    throw new Error(`openai_images ${r.status}: ${msg}`);
  }
  const item = r.json.data?.[0];
  let png: Buffer;
  if (item?.b64_json) png = Buffer.from(item.b64_json, "base64");
  else if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`openai_images image fetch ${img.status}`);
    png = Buffer.from(await img.arrayBuffer());
  } else throw new Error("openai_images: response had no image");
  log.info({ model, bytes: png.length }, "openai_images.ok");
  return { png, model, usd: env.OPENAI_IMAGE_USD_PER_IMAGE };
}
