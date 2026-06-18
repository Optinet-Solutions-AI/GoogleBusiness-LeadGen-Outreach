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

export interface HtmlRenderLead {
  business_name: string;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  brand_color?: string | null;
  reviews?: Array<{ text?: string; rating?: number; author?: string }>;
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
  /** Original accent hex — used when the lead has no brand color. */
  accent?: string;
  phone?: string;
  phone_tel?: string;
  address?: string;
  email?: string;
  email_href?: string;
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
  const accent = (lead.brand_color ?? defaults.accent ?? "").trim();

  const scalarMap: Record<string, string> = {
    business_name: escapeHtml(lead.business_name),
    phone: escapeHtml(phone),
    phone_tel: phone ? telDigits(phone) : defaults.phone_tel ?? "",
    address: escapeHtml(address),
    email: escapeHtml(email),
    email_href: email || defaults.email_href || "",
    accent: accent || defaults.accent || "",
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
  const reviewsSource: DefaultReview[] = realReviews.length > 0 ? realReviews : defaults.reviews ?? [];

  const hoursSource: DefaultHoursRow[] =
    lead.business_hours && Object.keys(lead.business_hours).length > 0
      ? Object.entries(lead.business_hours).map(([label, value]) => ({ label, value }))
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

  // ── JSON tokens (opt-in, React-bundle designs) ─────────────────────────
  if (out.includes("{{reviews_json}}")) {
    out = out.split("{{reviews_json}}").join(JSON.stringify(reviewsSource));
  }
  if (out.includes("{{hours_json}}")) {
    out = out.split("{{hours_json}}").join(JSON.stringify(hoursSource));
  }

  // ── Scalars last (so values injected into blocks are also resolved) ────
  out = fillTokens(out, scalarMap);

  const distDir = path.join(outDir, "dist");
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(distDir, "index.html"), out, "utf-8");
  return distDir;
}
