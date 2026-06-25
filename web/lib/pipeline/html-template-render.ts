/**
 * html-template-render.ts — Render a single-file HTML template by token swap.
 *
 * Inputs:  lead data + a `templates/<slug>/` dir containing `template.html`,
 *          a `defaults.json`, and optional `partials/{review,hours-row}.html`.
 * Outputs: `<outDir>/dist/index.html` (self-contained), returns its path.
 * Used by: lib/pipeline/stage-3-generate.ts (HTML-template branch).
 *
 * Why: four of our niche templates (trades/dental/chiropractic/restaurant)
 * are hand-built single-file HTML. Rather than rebuild them as Astro, we
 * personalize them with a pure string-token swap — no Gemini, no npm build,
 * deterministic and ~free. The bespoke body copy (menu, services, bios) is
 * left as the template's designed default; only identity, contact, reviews,
 * hours, and the accent color are swapped in.
 *
 * Opt-in dynamics: scalar tokens ({{business_name}} etc.) apply to every
 * template. The repeated {{reviews}} / {{hours}} blocks only render when the
 * template actually contains those tokens — a template that omits them keeps
 * its own designed reviews/hours (e.g. the React-export auto template).
 * {{reviews_json}} / {{hours_json}} emit JSON arrays for React-bundle designs
 * whose data lives in a JS array literal rather than markup.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { fetchImageBuffer } from "../services/image-fetch";

export interface HtmlRenderLead {
  business_name: string;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
  /** When true, render the logo as a circular avatar (for social profile
   *  pictures — square photos that look cleanest cropped to a circle). */
  logo_is_avatar?: boolean | null;
  /** Google Maps category — used to pick niche-appropriate stock imagery. */
  category?: string | null;
  /** Real scraped photos (Apify Google photos); blended with niche stock. */
  photos?: Array<string | { url?: string; name?: string }>;
  reviews?: Array<{ text?: string; rating?: number; author?: string }>;
  /** Real Google rating + count — shown as a credible badge when we have no
   *  review TEXT (so we never ship fabricated testimonial quotes). */
  rating?: number | null;
  review_count?: number | null;
  /** AI-generated descriptive copy (non-factual); falls back to template defaults. */
  tagline?: string | null;
  hero_sub?: string | null;
  about?: string | null;
  business_hours?: Record<string, string> | null;
}

interface DefaultReview {
  stars?: string;
  text: string;
  author: string;
  meta?: string;
}
interface DefaultHoursRow {
  label: string;
  value: string;
}
interface TemplateDefaults {
  /** "dark" when the template's nav/hero is dark — flips the white-logo
   *  treatment (keep it light) vs. light navs (recolor a white logo dark). */
  theme?: string;
  /** Original accent hex — used when the lead has no brand color. */
  accent?: string;
  phone?: string;
  phone_tel?: string;
  address?: string;
  email?: string;
  email_href?: string;
  /** Original template copy — fallback when AI copy isn't supplied. */
  tagline?: string;
  hero_sub?: string;
  about?: string;
  reviews?: DefaultReview[];
  hours?: DefaultHoursRow[];
}

/** Minimal HTML-text escape for values injected into element content/attrs. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replace every `{{key}}` occurrence with map[key] (literal, no escaping). */
export function fillTokens(src: string, map: Record<string, string>): string {
  return src.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : whole,
  );
}

/** Digits-only (plus leading +) phone for a tel: href. */
export function telDigits(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned.startsWith("+") ? cleaned : cleaned.replace(/\+/g, "");
}

/** Darken a #rrggbb hex by `amount` (0–1). Used for {{accent_dark}} (hover/
 *  pressed states) so a template's darker brand shade tracks the real accent
 *  instead of staying a hardcoded color that clashes with the logo. */
export function darkenHex(hex: string, amount = 0.22): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const f = 1 - Math.max(0, Math.min(1, amount));
  const ch = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** Darken an accent that's too light to read on the templates' light (cream/
 *  white) backgrounds — e.g. a bright yellow logo color. Scales RGB down until
 *  luminance is within range, preserving hue so it still matches the logo. */
export function ensureReadableOnLight(hex: string, maxLum = 0.58): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = () => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const cur = lum();
  if (cur <= maxLum) return `#${h.toLowerCase()}`;
  const f = maxLum / cur;
  [r, g, b] = [r, g, b].map((c) => Math.round(c * f));
  const x = (n: number) => n.toString(16).padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}`;
}

/** Lighten an accent that's too dark to read on a DARK-theme template (e.g. a
 *  navy brand color on a dark hero). Inverse of ensureReadableOnLight; used for
 *  the {{accent_on_dark}} token that dark designs apply to on-dark elements. */
export function ensureReadableOnDark(hex: string, minLum = 0.5): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = () => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  let guard = 0;
  while (lum() < minLum && guard++ < 24) {
    r = Math.round(r + (255 - r) * 0.18);
    g = Math.round(g + (255 - g) * 0.18);
    b = Math.round(b + (255 - b) * 0.18);
  }
  const x = (n: number) => n.toString(16).padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}`;
}

/** A data:image/...;base64 URI → Buffer (node-vibrant can't fetch a data URI,
 *  but it accepts a Buffer). Returns null for non-data or non-base64 URIs. */
function dataUriToBuffer(uri: string): Buffer | null {
  const m = uri.match(/^data:image\/[^;]+;base64,(.+)$/i);
  return m ? Buffer.from(m[1], "base64") : null;
}

/**
 * Remove a solid white background from a PNG logo by flood-filling near-white
 * pixels inward from the image edges and setting their alpha to 0. Edge flood
 * (not a global white→transparent swap) preserves white used INSIDE the logo
 * (white text/highlights that aren't connected to the border). Returns the
 * cleaned PNG bytes, or null when the image isn't a PNG or has no real white
 * background to remove (so the original is kept). Never throws.
 */
export function removeWhiteBackground(buf: Buffer): Buffer | null {
  let png: PNG;
  try {
    png = PNG.sync.read(buf);
  } catch {
    return null; // not a decodable PNG
  }
  const { width, height, data } = png;
  if (width < 8 || height < 8) return null;
  const isWhite = (i: number) =>
    data[i + 3] > 40 && data[i] >= 236 && data[i + 1] >= 236 && data[i + 2] >= 236;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    const i = p * 4;
    if (isWhite(i)) {
      data[i + 3] = 0; // clear background pixel
      stack.push(x, y);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  let cleared = 0;
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] === 0) cleared++;
  // <8% cleared = no genuine white background (just stray light corners) — keep
  // the original so we don't risk chewing into a logo that bleeds to the edge.
  if (cleared < width * height * 0.08) return null;
  try {
    return PNG.sync.write(png);
  } catch {
    return null;
  }
}

/** Best-effort: is this logo image mostly light (would vanish on a light nav)?
 *  Uses node-vibrant's palette; any failure → false (render the logo bare).
 *  Accepts an http(s) URL or a decoded image Buffer (for inlined data URIs). */
async function logoLooksLight(src: string | Buffer): Promise<boolean> {
  try {
    const { Vibrant } = await import("node-vibrant/node");
    const palette = await Vibrant.from(src as string).getPalette();
    const sw = Object.values(palette).filter(Boolean) as Array<{ rgb: number[]; population: number }>;
    // No extractable swatch = a white / transparent / mono logo — exactly the
    // case that vanishes on a light nav, so it DOES need the contrasting chip.
    if (!sw.length) return true;
    let tot = 0, wsum = 0;
    for (const s of sw) {
      const [r, g, b] = s.rgb;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const w = s.population || 1;
      tot += l * w; wsum += w;
    }
    return wsum > 0 && tot / wsum > 0.72;
  } catch {
    return false;
  }
}

/** Relative luminance (0..1) of a CSS color token, or null if not a solid color
 *  (none / transparent / currentColor / a url() gradient ref). Handles #rgb,
 *  #rrggbb, rgb()/rgba(), and the handful of named colors logos actually use. */
function colorLuminance(tokenRaw: string): number | null {
  const t = tokenRaw.trim().toLowerCase();
  if (!t || t === "none" || t === "transparent" || t === "currentcolor" || t.startsWith("url(")) {
    return null;
  }
  const named: Record<string, string> = {
    white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff",
    green: "#008000", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  };
  let hex = named[t] ?? t;
  let r: number, g: number, b: number;
  let m = hex.match(/^#([0-9a-f]{3})$/);
  if (m) {
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  } else if ((m = hex.match(/^#([0-9a-f]{6})$/))) {
    const n = parseInt(m[1], 16);
    r = (n >> 16) & 0xff; g = (n >> 8) & 0xff; b = n & 0xff;
  } else if ((m = hex.match(/^rgba?\(([^)]+)\)/))) {
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    if (parts.length < 3 || parts.some((x) => Number.isNaN(x))) return null;
    [r, g, b] = parts;
  } else {
    return null;
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Is this SVG logo essentially light (so it would vanish on a light nav and
 *  needs recoloring)? node-vibrant can't rasterize SVG, so we inspect the SVG's
 *  declared fill/stroke colors directly — from inline attributes, `style=`
 *  attributes, AND `<style>` CSS classes (Adobe Illustrator exports use the
 *  latter, e.g. `.st0{fill:#FFFFFF}`). Light iff EVERY solid color is light.
 *  Our generated monograms always carry one dark element (the brand chip or a
 *  contrast-checked text fill), so they return false and are left untouched. */
export function svgLooksLight(svg: string): boolean {
  const tokens: string[] = [];
  // <style> blocks: any fill:/stroke: declaration inside a rule body.
  for (const block of svg.matchAll(/\{([^}]*)\}/g)) {
    for (const c of block[1].matchAll(/(?:fill|stroke)\s*:\s*([^;]+)/gi)) tokens.push(c[1]);
  }
  // inline fill="..." / stroke="..." attributes.
  for (const a of svg.matchAll(/(?:fill|stroke)\s*=\s*["']([^"']+)["']/gi)) tokens.push(a[1]);
  // inline style="fill:...;stroke:..." attributes.
  for (const a of svg.matchAll(/style\s*=\s*["']([^"']*)["']/gi)) {
    for (const c of a[1].matchAll(/(?:fill|stroke)\s*:\s*([^;]+)/gi)) tokens.push(c[1]);
  }
  const lums = tokens
    .map(colorLuminance)
    .filter((x): x is number => x !== null);
  // No solid color at all = a white/transparent/currentColor logo → vanishes.
  if (!lums.length) return true;
  return lums.every((l) => l > 0.72);
}

function stars(rating?: number): string {
  const n = Math.max(1, Math.min(5, Math.round(rating ?? 5)));
  return "★".repeat(n);
}

async function readMaybe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Render the template at `templateDir` for `lead`, writing
 * `<outDir>/dist/index.html`. Returns the dist directory path.
 */
export async function renderHtmlTemplate(
  lead: HtmlRenderLead,
  templateDir: string,
  outDir: string,
): Promise<string> {
  const templateHtml = await fs.readFile(
    path.join(templateDir, "template.html"),
    "utf-8",
  );
  const defaultsRaw = await readMaybe(path.join(templateDir, "defaults.json"));
  const defaults: TemplateDefaults = defaultsRaw ? JSON.parse(defaultsRaw) : {};

  // ── Scalars (lead value wins, else template default) ───────────────────
  const phone = (lead.phone ?? defaults.phone ?? "").trim();
  const address = (lead.address ?? defaults.address ?? "").trim();
  const email = (lead.email ?? defaults.email ?? "").trim();
  // Clamp light accents (e.g. bright yellow) so they stay readable on the
  // templates' light backgrounds; preserves hue → still matches the logo.
  const accentRaw = (lead.brand_color ?? defaults.accent ?? "").trim();
  const accent = accentRaw ? ensureReadableOnLight(accentRaw) : "";

  // {{logo}} renders the real fetched logo as an <img> when we have a raster
  // image (http(s) or data:image, excluding the generated SVG monogram), and
  // falls back to the plain business-name text otherwise. The text fallback
  // inherits the surrounding brand-link's font styling, so a logo-less lead
  // looks exactly like the template's original wordmark.
  const logo = (lead.logo_url ?? "").trim();
  // Accept: any http(s) logo (incl. crisp .svg site logos), raster data URIs,
  // and our base64-encoded SVG monogram fallback. Reject raw `data:image/svg+xml,…`
  // (lazy-load placeholders) and `data:;` junk.
  const isRealLogo =
    /^https?:\/\//i.test(logo) ||
    /^data:image\/(png|jpe?g|gif|webp);/i.test(logo) ||
    /^data:image\/svg\+xml;base64,/i.test(logo);
  // Single-quoted attributes so the <img> is safe both as raw HTML (plain
  // templates) AND when injected inside the bundler's JSON-escaped template
  // string (the React-bundle designs, whose markup uses \"-escaped quotes).
  const logoSrc = logo.replace(/'/g, "%27");
  const logoAlt = escapeHtml(lead.business_name).replace(/'/g, "&#39;");
  const logoStyle = lead.logo_is_avatar
    ? "height:54px;width:54px;border-radius:50%;object-fit:cover;display:inline-block;vertical-align:middle;"
    : "height:54px;width:auto;max-width:240px;display:inline-block;vertical-align:middle;object-fit:contain;";
  // A light/white logo would be invisible on a light nav — detect it and sit
  // it on a small dark chip so it's always visible (nav-background-agnostic).
  // Detect a light/white logo on both http(s) URLs AND inlined data URIs
  // (logos are now downloaded + inlined, so the old http-only check skipped
  // them — a white logo then vanished on a light nav, e.g. Farish House).
  const logoBuf = /^data:image\//i.test(logo) ? dataUriToBuffer(logo) : null;
  // SVG logos can't be rasterized by node-vibrant (it silently fails → "not
  // light" → a white SVG vanished on a light nav, e.g. First Class Auto). Parse
  // the SVG's declared fills/strokes instead; raster logos still use Vibrant.
  const isSvgLogo = /^data:image\/svg\+xml;base64,/i.test(logo);
  let logoLight = false;
  if (isRealLogo && !lead.logo_is_avatar) {
    if (isSvgLogo && logoBuf) {
      logoLight = svgLooksLight(logoBuf.toString("utf8"));
    } else if (/^https?:\/\//i.test(logo) || logoBuf) {
      logoLight = await logoLooksLight(logoBuf ?? logo);
    }
  }
  // White-background handling: a logo on a solid white background shows as a
  // white box on a colored/cream nav. For raster logos that AREN'T light (those
  // are handled by the recolor below) and aren't our SVG monogram, strip the
  // white background. PNGs are cleaned to transparency in place (flood-fill from
  // the edges, preserving interior white); JPEGs can't carry transparency, so
  // they fall back to a clean white rounded chip that reads as an intentional
  // logo badge instead of a stray box.
  let logoForImg = logoSrc;
  let useChip = false;
  if (isRealLogo && !lead.logo_is_avatar && !isSvgLogo && !logoLight) {
    let bytes = logoBuf;
    let ct = /^data:(image\/[a-z0-9.+-]+)/i.exec(logo)?.[1]?.toLowerCase() ?? "";
    if (!bytes && /^https?:\/\//i.test(logo)) {
      const img = await fetchImageBuffer(logo).catch(() => null);
      if (img) {
        bytes = img.buffer;
        ct = img.contentType.toLowerCase();
      }
    }
    if (bytes) {
      if (/jpe?g/i.test(ct)) {
        useChip = true; // opaque format, can't be made transparent
      } else {
        const cleaned = removeWhiteBackground(bytes);
        if (cleaned) {
          logoForImg = `data:image/png;base64,${cleaned.toString("base64")}`.replace(/'/g, "%27");
        }
      }
    }
  }
  // A white/light logo vanishes on a light nav. Rather than box it (which reads
  // as "pasted"), recolor it to a clean dark monochrome so it sits on the nav
  // like a normal logo. On a dark-nav template we instead keep it light.
  const darkNav = defaults.theme === "dark";
  const chip = (inner: string) =>
    useChip
      ? `<span class='dc-logo-chip' style='display:inline-flex;align-items:center;background:#fff;border-radius:8px;padding:5px 9px;'>${inner}</span>`
      : inner;
  let logoHtml: string;
  if (!isRealLogo) {
    logoHtml = escapeHtml(lead.business_name);
  } else if (logoLight && !darkNav) {
    logoHtml = `<img src='${logoForImg}' alt='${logoAlt}' class='dc-logo' style='${logoStyle}filter:brightness(0) saturate(100%);'>`;
  } else {
    logoHtml = chip(`<img src='${logoForImg}' alt='${logoAlt}' class='dc-logo' style='${logoStyle}'>`);
  }

  // ── Imagery: the business's REAL photos ONLY ───────────────────────────
  // Operator policy: never pad with niche stock. Generic stock repeats across
  // same-niche sites (the same wrench/engine shots on every auto demo) and
  // isn't the actual business, so it reads as fake. We show only the lead's own
  // Google photos; templates that have fewer slots filled adapt (a thinner but
  // ACCURATE page beats a full page of reused stock). Pulled via {{hero_image}},
  // {{photo_1..6}}, {{gallery}}, {{photos_json}}; empty slots render nothing.
  const realPhotos = (lead.photos ?? [])
    .map((p) => (typeof p === "string" ? p : p && typeof p === "object" ? p.url ?? null : null))
    .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  const photos = Array.from(new Set(realPhotos)).slice(0, 8);

  const scalarMap: Record<string, string> = {
    business_name: escapeHtml(lead.business_name),
    logo: logoHtml,
    phone: escapeHtml(phone),
    phone_tel: phone ? telDigits(phone) : defaults.phone_tel ?? "",
    address: escapeHtml(address),
    email: escapeHtml(email),
    email_href: email || defaults.email_href || "",
    accent: accent || defaults.accent || "",
    accent_dark: darkenHex(accent || defaults.accent || "#1F4E79"),
    // Lightened accent for dark-theme designs (used on on-dark elements so a
    // dark brand color doesn't disappear on a dark hero/nav).
    accent_on_dark: ensureReadableOnDark(accentRaw || defaults.accent || "#1F4E79"),
    // Scalar photo slots fall back to the LAST available real photo (not "")
    // so a design with a fixed {{photo_2}} slot never renders a broken <img>
    // when the business has fewer photos than slots. Repeating the business's
    // own photo is fine; it's never another business's stock.
    hero_image: photos[0] ?? "",
    photo_1: photos[0] ?? "",
    photo_2: photos[1] ?? photos[photos.length - 1] ?? "",
    photo_3: photos[2] ?? photos[photos.length - 1] ?? "",
    photo_4: photos[3] ?? photos[photos.length - 1] ?? "",
    photo_5: photos[4] ?? photos[photos.length - 1] ?? "",
    photo_6: photos[5] ?? photos[photos.length - 1] ?? "",
    tagline: escapeHtml((lead.tagline ?? defaults.tagline ?? "").trim()),
    hero_sub: escapeHtml((lead.hero_sub ?? defaults.hero_sub ?? "").trim()),
    about: escapeHtml((lead.about ?? defaults.about ?? "").trim()),
  };

  // Canonical review/hours sources (real → fallback to defaults). Shared by
  // the HTML-block path (plain-HTML designs) and the JSON-token path (React
  // bundles whose data lives in a JS array, not markup).
  const realReviews = (lead.reviews ?? [])
    .filter((r) => typeof r?.text === "string" && r.text!.trim().length > 15)
    .slice(0, 3)
    .map<DefaultReview>((r) => ({
      stars: stars(r.rating),
      text: r.text!.trim(),
      author: (r.author ?? "Verified customer").trim(),
      meta: "Google review",
    }));
  // Reviews priority: real review TEXT → a real rating badge (rating + count,
  // never fabricated quotes) → template defaults only as a last resort.
  let reviewsSource: DefaultReview[];
  if (realReviews.length > 0) {
    reviewsSource = realReviews;
  } else if (typeof lead.rating === "number" && lead.rating > 0 && (lead.review_count ?? 0) > 0) {
    const count = (lead.review_count as number).toLocaleString("en-US");
    reviewsSource = [
      {
        stars: stars(lead.rating),
        text: `Rated ${lead.rating.toFixed(1)} out of 5 by ${count} customers on Google.`,
        author: "Verified Google rating",
        meta: `${count} reviews`,
      },
    ];
  } else {
    reviewsSource = defaults.reviews ?? [];
  }

  const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const hoursSource: DefaultHoursRow[] =
    lead.business_hours && Object.keys(lead.business_hours).length > 0
      ? Object.entries(lead.business_hours)
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => {
            const i = DAY_ORDER.indexOf(a.label.trim().toLowerCase().slice(0, 9));
            const j = DAY_ORDER.indexOf(b.label.trim().toLowerCase().slice(0, 9));
            return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
          })
      : defaults.hours ?? [];

  // ── Reviews block (opt-in) ─────────────────────────────────────────────
  let out = templateHtml;
  if (out.includes("{{reviews}}")) {
    const partial = await readMaybe(path.join(templateDir, "partials", "review.html"));
    const html = partial
      ? reviewsSource
          .map((r) =>
            fillTokens(partial, {
              stars: r.stars ?? "★★★★★",
              review_text: escapeHtml(r.text),
              review_author: escapeHtml(r.author),
              review_meta: escapeHtml(r.meta ?? ""),
            }),
          )
          .join("\n")
      : "";
    out = out.split("{{reviews}}").join(html);
  }

  // ── Hours block (opt-in) ───────────────────────────────────────────────
  if (out.includes("{{hours}}")) {
    const partial = await readMaybe(path.join(templateDir, "partials", "hours-row.html"));
    const html = partial
      ? hoursSource
          .map((r) =>
            fillTokens(partial, {
              hours_label: escapeHtml(r.label),
              hours_value: escapeHtml(r.value),
            }),
          )
          .join("\n")
      : "";
    out = out.split("{{hours}}").join(html);
  }

  // ── Gallery block (opt-in) ─────────────────────────────────────────────
  if (out.includes("{{gallery}}")) {
    const partial = await readMaybe(path.join(templateDir, "partials", "gallery-item.html"));
    const html = partial
      ? photos.slice(0, 6).map((u) => fillTokens(partial, { photo_url: u })).join("\n")
      : "";
    out = out.split("{{gallery}}").join(html);
  }

  // ── JSON tokens (opt-in, React-bundle designs) ─────────────────────────
  if (out.includes("{{reviews_json}}")) {
    out = out.split("{{reviews_json}}").join(JSON.stringify(reviewsSource));
  }
  if (out.includes("{{hours_json}}")) {
    out = out.split("{{hours_json}}").join(JSON.stringify(hoursSource));
  }
  if (out.includes("{{photos_json}}")) {
    out = out.split("{{photos_json}}").join(JSON.stringify(photos));
  }

  // ── Scalars last (so values injected into blocks are also resolved) ────
  out = fillTokens(out, scalarMap);

  const distDir = path.join(outDir, "dist");
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(distDir, "index.html"), out, "utf-8");
  return distDir;
}
