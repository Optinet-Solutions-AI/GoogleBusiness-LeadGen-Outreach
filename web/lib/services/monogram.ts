/**
 * monogram.ts — Deterministic SVG monogram generator (zero-cost logo fallback).
 *
 * Inputs:  business name + brand hex + optional category hint
 * Outputs: data:image/svg+xml;base64,... data URI suitable for <img src>
 * Used by: lib/services/logo.ts → fallback when Brandfetch finds no logo
 *
 * Why monograms instead of stock circles: a niche-aware typography choice
 * (serif for elegant boutiques, bold sans for trades) produces a logo that
 * reads as intentional design — not "AI couldn't find anything". Output is
 * ~300–500 bytes base64-encoded, so embedding in <img src> is fine.
 */

interface MonogramStyle {
  font: string;
  weight: number;
  letterSpacing: string;
  shape: "circle" | "rounded-square";
}

const ELEGANT_STYLE: MonogramStyle = {
  // Stack Playfair first, fall through to common serifs.
  font: '"Playfair Display", "EB Garamond", Georgia, "Times New Roman", serif',
  weight: 600,
  letterSpacing: "0.02em",
  shape: "circle",
};

const BOLD_STYLE: MonogramStyle = {
  font: '"Inter", system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  weight: 800,
  letterSpacing: "-0.04em",
  shape: "rounded-square",
};

/** Keywords that bias to elegant serif (boutiques / professional / lifestyle). */
const ELEGANT_KEYWORDS = [
  "salon", "spa", "boutique", "beauty", "florist", "flower",
  "estate", "antique", "vintage", "interior", "home_goods", "furniture",
  "law", "attorney", "lawyer", "financial", "accountant", "consult",
  "real_estate", "realtor", "jewelry", "wedding", "event",
  "cafe", "bistro", "patisserie", "wine",
];

function styleForCategory(category: string | null): MonogramStyle {
  if (!category) return BOLD_STYLE;
  const c = category.toLowerCase();
  if (ELEGANT_KEYWORDS.some((k) => c.includes(k))) return ELEGANT_STYLE;
  return BOLD_STYLE;
}

const FILLER_WORDS = new Set(["the", "a", "an", "and", "of", "for", "to"]);

/**
 * Pull 1–2 character initials from a business name.
 * - "Estate Sales & Treasures" → "ET"
 * - "Joe's Plumbing" → "JP"
 * - "Acme" → "AC"
 * - "" → "•"
 */
function initialsOf(businessName: string): string {
  const cleaned = businessName.replace(/[^A-Za-z0-9 ]/g, " ");
  const allWords = cleaned.split(/\s+/).filter(Boolean);
  const meaningful = allWords.filter((w) => !FILLER_WORDS.has(w.toLowerCase()));
  const words = meaningful.length ? meaningful : allWords;
  if (words.length === 0) return "•";
  if (words.length === 1) {
    const w = words[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Pick white or near-black text per WCAG luminance — duplicated here to avoid the palette.ts circular dep. */
function textOnHex(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? "#1A1F26" : "#FFFFFF";
}

export function generateMonogramSvg(opts: {
  business_name: string;
  brand_hex: string;
  category?: string | null;
}): string {
  const initials = initialsOf(opts.business_name);
  const style = styleForCategory(opts.category ?? null);
  const fg = textOnHex(opts.brand_hex);
  // Soft inner highlight gradient to add depth without looking busy.
  const lighten = fg === "#FFFFFF" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)";

  const shape =
    style.shape === "circle"
      ? `<circle cx="100" cy="100" r="96" fill="${opts.brand_hex}"/>` +
        `<circle cx="100" cy="100" r="96" fill="url(#g)"/>`
      : `<rect x="4" y="4" width="192" height="192" rx="34" fill="${opts.brand_hex}"/>` +
        `<rect x="4" y="4" width="192" height="192" rx="34" fill="url(#g)"/>`;

  // Drop the second initial for taller/wider visual weight on serif style;
  // looks more like a real brand monogram.
  const fontSize = initials.length === 1 ? 110 : 88;
  // Rough vertical centering for cap-height text in viewBox 0..200.
  const y = initials.length === 1 ? 132 : 128;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="${escapeXml(opts.business_name)} logo">` +
    `<defs><radialGradient id="g" cx="50%" cy="35%" r="65%">` +
    `<stop offset="0%" stop-color="${lighten}"/>` +
    `<stop offset="100%" stop-color="${lighten}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    shape +
    `<text x="100" y="${y}" text-anchor="middle" ` +
    `font-family='${style.font}' font-weight="${style.weight}" ` +
    `font-size="${fontSize}" letter-spacing="${style.letterSpacing}" ` +
    `fill="${fg}">${escapeXml(initials)}</text>` +
    `</svg>`;
  return svg;
}

export function generateMonogramDataUri(opts: {
  business_name: string;
  brand_hex: string;
  category?: string | null;
}): string {
  const svg = generateMonogramSvg(opts);
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
