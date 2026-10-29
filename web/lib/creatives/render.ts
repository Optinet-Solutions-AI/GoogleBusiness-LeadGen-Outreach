/**
 * render.ts — renders a creative version (template x aspects x slides) to PNGs in Chromium and stores them.
 *
 * Inputs:  clientId, versionId, creative {kind, template_key}, CreativeInputs, the assets the caller allows
 * Outputs: render brand_assets rows (origin 'render') in the client-assets bucket; RenderRef[] + overflow list
 * Used by: the creatives generation pipeline (Cloud Run job); pure helpers (slideCount) by unit tests
 */
import "@/lib/server-guard";
import type { BrowserContext } from "playwright";
import { newRenderRevision, storeRenderPng, type AssetRow } from "@/lib/clients/assets";
import type { Fact } from "@/lib/clients/types";
import { getLogger } from "@/lib/logger";
import { getBrowser } from "@/lib/services/headless-browser";
import { renderTemplateHtml } from "./templates";
import {
  ASPECTS,
  ASPECT_SIZE,
  type Aspect,
  type CreativeInputs,
  type CreativeKind,
  type RenderRef,
  type TemplateKey,
} from "./types";

const log = getLogger("creative-render");

export class RenderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderUnavailableError";
  }
}

export class RenderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderInputError";
  }
}

/** Slide indexes to render: image -> [null]; carousel -> 1..N with N = slides.length (3-5; <3 throws, >5 clamps). */
export function slideCount(
  kind: CreativeKind,
  inputs: CreativeInputs,
): (number | null)[] {
  if (kind !== "carousel") return [null];
  const n = inputs.slides?.length ?? 0;
  if (n < 3)
    throw new RenderInputError(`A carousel needs at least 3 slides (got ${n})`);
  return Array.from({ length: Math.min(n, 5) }, (_, i) => i + 1);
}

export type Fonts = { heading: "sans" | "serif"; body: "sans" | "serif" };

const KNOWN_SERIF =
  /playfair|georgia|merriweather|lora|garamond|baskerville|times|cormorant|libre caslon|bodoni/i;
const fontKind = (f: Fact<string> | null | undefined): "sans" | "serif" => {
  const v = f?.value ?? "";
  if (/sans/i.test(v)) return "sans";
  return /serif/i.test(v) || KNOWN_SERIF.test(v) ? "serif" : "sans";
};

/** Map the Brand Brain's visuals.fonts to the template font families (default sans). */
export function fontsFromProfile(
  fonts:
    { heading: Fact<string> | null; body: Fact<string> | null } | undefined,
): Fonts {
  return { heading: fontKind(fonts?.heading), body: fontKind(fonts?.body) };
}

/** Classify the value the template's fit script reported (null = it never reported). */
export function fitOutcome(
  value: string | null,
): "ok" | "overflow" | "timeout" {
  if (value === "ok") return "ok";
  if (value === "overflow") return "overflow";
  return "timeout";
}

async function waitForFit(
  page: import("playwright").Page,
): Promise<string | null> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const fit = await page.evaluate(
      () => document.documentElement.dataset.fit ?? null,
    );
    if (fit) return fit;
    await page.waitForTimeout(100);
  }
  return null;
}

export async function renderVersion(input: {
  clientId: string;
  versionId: string;
  creative: { kind: CreativeKind; template_key: TemplateKey };
  inputs: CreativeInputs;
  assets: AssetRow[];
  fonts?: Fonts;
}): Promise<{
  renders: RenderRef[];
  overflow: { aspect: Aspect; slide: number | null }[];
}> {
  const { clientId, versionId, creative, inputs, assets } = input;
  const fonts = input.fonts ?? { heading: "sans", body: "sans" };
  const slides = slideCount(creative.kind, inputs);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const urlOf = (id: string | null | undefined) =>
    id ? (byId.get(id)?.public_url ?? null) : null;
  const logoUrl = urlOf(inputs.logo_asset_id);
  const photoUrls = (inputs.photo_asset_ids ?? [])
    .map(urlOf)
    .filter((u): u is string => !!u);
  const backgroundUrl = urlOf(inputs.background_asset_id);
  const tags = ["render"];
  const rev = newRenderRevision(); // one new storage revision per render run (never a cached URL)

  let browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    log.error(
      { err: String(err).slice(0, 300) },
      "render.chromium_unavailable",
    );
    throw new RenderUnavailableError(
      "Chromium is not available in this environment",
    );
  }

  const renders: RenderRef[] = [];
  const overflow: { aspect: Aspect; slide: number | null }[] = [];
  for (const aspect of ASPECTS) {
    for (const slide of slides) {
      // RenderRef slides are 1-based; the template indexes inputs.slides from 0
      const html = renderTemplateHtml(creative.template_key, inputs, {
        aspect,
        slide: slide === null ? null : slide - 1,
        logoUrl,
        photoUrls,
        backgroundUrl,
        fonts,
      });
      const { w, h } = ASPECT_SIZE[aspect];
      let ctx: BrowserContext | null = null;
      try {
        ctx = await browser.newContext({
          viewport: { width: w, height: h },
          deviceScaleFactor: 1,
        });
        const page = await ctx.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const fit = fitOutcome(await waitForFit(page));
        if (fit === "timeout") {
          log.warn(
            { clientId, versionId, key: creative.template_key, aspect, slide },
            "render.fit_timeout",
          );
          throw new RenderInputError(
            `Template fit script did not report within 10 s (${creative.template_key} ${aspect} slide ${slide ?? 1})`,
          );
        }
        if (fit === "overflow") overflow.push({ aspect, slide });
        const png = await page.screenshot({ type: "png", fullPage: false });
        const row = await storeRenderPng({
          clientId,
          versionId,
          aspect,
          slide,
          png,
          tags,
          rev,
        });
        renders.push({
          aspect,
          slide,
          asset_id: row.id,
          public_url: row.public_url ?? "",
          width: row.width ?? w,
          height: row.height ?? h,
        });
      } finally {
        await ctx?.close().catch(() => undefined);
      }
    }
  }
  log.info(
    { clientId, versionId, renders: renders.length, overflow: overflow.length },
    "render.done",
  );
  return { renders, overflow };
}
