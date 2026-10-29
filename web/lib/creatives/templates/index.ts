/**
 * index.ts — renders a post template (product-hero / offer / tip-quote / review) to a self-contained HTML string.
 *
 * Inputs:  TemplateKey + CreativeInputs + render context (aspect, slide, asset URLs, fonts)
 * Outputs: HTML with fonts inlined and a fit-to-frame script (sets documentElement.dataset.fit)
 * Used by: creatives render pipeline (Playwright screenshot), template unit tests.
 *          Server-only (reads template files via node:fs); UI code imports ./registry instead.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { escapeHtml, fillTokens } from "@/lib/pipeline/html-template-render";
import { CreativeInputsSchema, type Aspect, type CreativeInputs, type TemplateKey } from "../types";
import { fontFaceCss } from "./fonts";

export { TEMPLATES } from "./registry";
export type { TemplateMeta } from "./registry";

export interface RenderContext {
  aspect: Aspect;
  slide: number | null;
  logoUrl: string | null;
  photoUrls: string[];
  backgroundUrl: string | null;
  fonts: { heading: "sans" | "serif"; body: "sans" | "serif" };
}

const DIR = () => path.join(process.cwd(), "lib/creatives/templates");
const fileCache = new Map<string, string>();
function readCached(rel: string): string {
  let v = fileCache.get(rel);
  if (v === undefined) {
    v = fs.readFileSync(path.join(DIR(), rel), "utf8");
    fileCache.set(rel, v);
  }
  return v;
}

/** Shrinks .fit elements 4% at a time (floor 40% of start) until they fit, then reports. */
export const FIT_SCRIPT = `(function(){
function run(){
  var all = true;
  var els = document.querySelectorAll(".fit");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var start = parseFloat(getComputedStyle(el).fontSize);
    var size = start;
    var over = function(){ return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1; };
    while (over() && size > start * 0.4) { size = size * 0.96; el.style.fontSize = size + "px"; }
    if (over()) all = false;
  }
  document.documentElement.dataset.fit = all ? "ok" : "overflow";
}
function go(){ (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(run, run); }
if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();`;

const FALLBACK = { primary: "#1F4E79", accent: "#E8B931", background: "#FFFFFF", text: "#111111" };
const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v: string | undefined, fb: string) => (v && HEX.test(v.trim()) ? v.trim() : fb);

function inkFor(bg: string): string {
  const n = parseInt(bg.slice(1), 16);
  const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? "#111111" : "#FFFFFF";
}

const fontStack = (f: "sans" | "serif") =>
  f === "serif" ? `"BrandSerif",Georgia,"Times New Roman",serif` : `"BrandSans",system-ui,-apple-system,"Segoe UI",Arial,sans-serif`;

/** Escape for HTML text/attribute and defuse `{{` so user text can never look like a token. */
const esc = (s: string) => escapeHtml(s).replace(/\{\{/g, "{&#123;");
const url = (u: string | null) => (u ? esc(u) : "");

export function renderTemplateHtml(key: TemplateKey, inputs: CreativeInputs, ctx: RenderContext): string {
  const c = inputs.colors;
  const primary = hex(c?.primary, FALLBACK.primary);
  const accent = hex(c?.accent, FALLBACK.accent);
  const bg = hex(c?.background, FALLBACK.background);
  const text = hex(c?.text, FALLBACK.text);

  const slides = inputs.slides ?? [];
  const slide = ctx.slide !== null ? slides[ctx.slide] : undefined;
  const headline = slide ? slide.headline : inputs.headline;
  const subhead = slide ? slide.subhead : inputs.subhead;
  const marker =
    ctx.slide !== null && slides.length > 0
      ? `<div class="slide-marker">${ctx.slide + 1} / ${slides.length}</div>`
      : "";

  const photo = ctx.photoUrls[0] ?? null;
  const bodyCls = [ctx.backgroundUrl ? "has-bg" : "", photo ? "has-photo" : ""].filter(Boolean).join(" ");

  const vars = `:root{--primary:${primary};--accent:${accent};--bg:${bg};--text:${text};--cta-text:${inkFor(accent)};--font-heading:${fontStack(ctx.fonts.heading)};--font-body:${fontStack(ctx.fonts.body)}}`;

  return fillTokens(readCached(`${key}/index.html`), {
    font_css: fontFaceCss(),
    vars_css: vars,
    base_css: readCached("base.css"),
    fit_script: FIT_SCRIPT,
    aspect: ctx.aspect,
    headline: esc(headline),
    subhead: esc(subhead),
    cta_text: esc(inputs.cta_text),
    body: esc(inputs.body ?? ""),
    logo_url: url(ctx.logoUrl),
    photo_url: url(photo),
    background_url: url(ctx.backgroundUrl),
    logo_cls: ctx.logoUrl ? "" : "hidden",
    photo_cls: photo ? "" : "hidden",
    bg_cls: ctx.backgroundUrl ? "" : "hidden",
    body_cls: bodyCls,
    slide_marker: marker,
    color_primary: primary,
    color_accent: accent,
    color_background: bg,
    color_text: text,
  });
}

/** Required-field schema per template (on top of the base CreativeInputs shape). */
export function templateInputSchema(key: TemplateKey): z.ZodType<CreativeInputs> {
  const need = (s: string | undefined) => (s ?? "").trim().length > 0;
  return CreativeInputsSchema.superRefine((v, ctx) => {
    const miss = (p: string, m: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [p], message: m });
    if (!need(v.headline)) miss("headline", "headline is required");
    if ((key === "product-hero" || key === "offer") && !need(v.cta_text)) miss("cta_text", "cta_text is required");
    if (key === "review") {
      if (!need(v.body)) miss("body", "review quote (body) is required");
      if (!need(v.subhead)) miss("subhead", "review author (subhead) is required");
    }
    if (key === "product-hero" && v.photo_asset_ids.length < 1) miss("photo_asset_ids", "at least one photo is required");
  });
}
