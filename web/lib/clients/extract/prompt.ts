/**
 * prompt.ts — build the Brand Brain extraction input (budget-trimmed) and render the user prompt.
 *
 * Inputs:  ExtractionInput (operator intake, Google Maps facts, crawled pages, assets)
 * Outputs: trimmed ExtractionInput; labelled user-prompt text for Gemini; the intake/Maps section texts
 * Used by: lib/services/gemini-brand.ts, lib/clients/build-brain.ts (quote checks use the same section text)
 *
 * Pure — no network, no env.
 */
import type { IntakeForm } from "@/lib/clients/sources";
import { rankPagesForPrompt } from "@/lib/clients/crawl/page-select";

export type MapsFacts = {
  name: string | null;
  category: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number | null;
  hours: Record<string, string> | null;
  reviews: { author: string | null; rating: number | null; text: string }[];
};

export type ExtractionPage = { id: string; url: string; title: string | null; text: string };
export type ExtractionAsset = { id: string; alt: string | null; source_url: string | null };

export type ExtractionInput = {
  intake: IntakeForm | null;
  maps: MapsFacts | null;
  pages: ExtractionPage[];
  assets: ExtractionAsset[];
  language: string | null;
};

/** Rank pages (home, about, services, pricing, contact first) and trim their text to `budget` chars total. */
export function buildExtractionInput(raw: ExtractionInput, budget: number): ExtractionInput {
  const ranked = rankPagesForPrompt(raw.pages) as ExtractionPage[];
  const pages: ExtractionPage[] = [];
  let left = Math.max(0, budget);
  for (const p of ranked) {
    if (left <= 0) break;
    const text = p.text.length <= left ? p.text : p.text.slice(0, left);
    if (!text) continue;
    pages.push({ ...p, text });
    left -= text.length;
  }
  return { ...raw, pages };
}

/** The OPERATOR INTAKE section body — also the text `operator` fact quotes are checked against. */
export function renderIntake(i: IntakeForm): string {
  const lines: [string, string][] = [
    ["Sells", i.sells],
    ["Customers", i.customers],
    ["Tone", i.tone.join(", ")],
    ["Tone note", i.tone_note],
    ["Always mention", i.always_mention],
    ["Never claim", i.never_claim],
    ["Preferred call to action", [i.cta_kind, i.cta_target].filter(Boolean).join(" - ")],
    ["Other", i.other],
  ];
  return lines
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** The GOOGLE MAPS section body — also the text `google_maps` fact quotes are checked against. */
export function renderMaps(m: MapsFacts): string {
  const lines: string[] = [];
  const add = (k: string, v: string | number | null) => {
    if (v !== null && v !== "") lines.push(`${k}: ${v}`);
  };
  add("Name", m.name);
  add("Category", m.category);
  add("Address", m.address);
  add("Phone", m.phone);
  add("Rating", m.rating);
  add("Review count", m.review_count);
  if (m.hours && Object.keys(m.hours).length) {
    lines.push("Hours: " + Object.entries(m.hours).map(([d, h]) => `${d} ${h}`).join("; "));
  }
  if (m.reviews.length) {
    lines.push("Sample reviews:");
    for (const r of m.reviews) {
      lines.push(`- ${r.author ?? "anon"}${r.rating != null ? ` (${r.rating} stars)` : ""}: ${r.text}`);
    }
  }
  return lines.join("\n");
}

export function renderUserPrompt(input: ExtractionInput): string {
  const sections: string[] = [];
  if (input.language) sections.push(`Primary language: ${input.language}`);
  if (input.intake) {
    const body = renderIntake(input.intake);
    if (body) sections.push(`# OPERATOR INTAKE (authoritative)\n${body}`);
  }
  if (input.maps) {
    const body = renderMaps(input.maps);
    if (body) sections.push(`# GOOGLE MAPS\n${body}`);
  }
  if (input.pages.length) {
    const pages = input.pages
      .map((p) => `## PAGE ${p.id} ${p.url}${p.title ? `\nTitle: ${p.title}` : ""}\n${p.text}`)
      .join("\n\n");
    sections.push(`# PAGES\n${pages}`);
  }
  if (input.assets.length) {
    const assets = input.assets
      .map((a) => `- ${a.id}${a.alt ? ` alt="${a.alt}"` : ""}${a.source_url ? ` ${a.source_url}` : ""}`)
      .join("\n");
    sections.push(`# ASSETS\n${assets}`);
  }
  return sections.join("\n\n");
}
