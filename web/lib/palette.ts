/**
 * palette.ts — Derive a 5-color palette from a single brand_color hex.
 *
 * Inputs:  hex string like '#1F4E79'
 * Outputs: { primary, primary_text, accent, surface, surface_alt, neutral_900, neutral_500 }
 * Used by: lib/pipeline/stage-3-generate.ts (writes into data.json.palette)
 *
 * Strategy:
 *   - Convert hex → HSL
 *   - primary       = the brand color, with luminance clamped to [0.35, 0.6]
 *                     (ensures legible text on white and decent contrast on dark)
 *   - primary_text  = white or near-black depending on primary luminance (WCAG)
 *   - accent        = primary with hue rotated +30° (analogous, energetic)
 *   - surface       = #FFFFFF
 *   - surface_alt   = primary at very low saturation + 96% lightness (subtle tint)
 *   - neutral_900   = primary at 8% saturation + 12% lightness (dark text bg)
 *   - neutral_500   = primary at 8% saturation + 50% lightness (mid neutral)
 *
 * Falls back to a known-safe blue palette if input is malformed.
 */

export interface Palette {
  primary: string;
  primary_text: string;
  accent: string;
  surface: string;
  surface_alt: string;
  neutral_900: string;
  neutral_500: string;
}

const FALLBACK: Palette = {
  primary: "#1F4E79",
  primary_text: "#FFFFFF",
  accent: "#E07B00",
  surface: "#FFFFFF",
  surface_alt: "#F4F7FA",
  neutral_900: "#1A1F26",
  neutral_500: "#6B7280",
};

export function derivePalette(brandHex: string | null | undefined): Palette {
  if (!brandHex) return FALLBACK;
  const rgb = hexToRgb(brandHex);
  if (!rgb) return FALLBACK;

  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const lClamped = Math.min(0.6, Math.max(0.35, l));

  const primary = hslToHex(h, s, lClamped);
  const accentHue = (h + 30 / 360) % 1;
  const accent = hslToHex(accentHue, Math.max(0.55, s), 0.5);
  const surface_alt = hslToHex(h, 0.18, 0.96);
  const neutral_900 = hslToHex(h, 0.08, 0.12);
  const neutral_500 = hslToHex(h, 0.08, 0.5);

  return {
    primary,
    primary_text: textOn(primary),
    accent,
    surface: "#FFFFFF",
    surface_alt,
    neutral_900,
    neutral_500,
  };
}

/* ---------- color math (no deps) ---------- */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** Picks white or near-black for legible text on the supplied bg color. */
function textOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#FFFFFF";
  // Relative luminance per WCAG
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? "#1A1F26" : "#FFFFFF";
}
