/**
 * leads/import.ts — Shared lead intake for app / CSV / manual sources. Pure helpers.
 *
 * Inputs:  raw lead rows (CSV row or manual form) + source
 * Outputs: validated/normalized LeadInput, a dedupe key, and a leads-table row
 * Used by: app/api/leads/import (CSV), app/api/leads (manual) — wired in a later chunk
 *
 * The source-agnostic seam: every source funnels through validate → normalize →
 * dedupe → buildLeadRow, so adding a new source later is just a new caller.
 * DB insert lives in the route; these functions stay pure + unit-tested.
 */

import { deriveSegment, type CallSegment } from "../segment";

export type LeadSource = "scraped" | "csv" | "manual";

export interface RawLead {
  business_name?: string;
  phone?: string;
  city?: string;
  country_code?: string;
  website_url?: string;
}

export interface LeadInput {
  business_name: string;
  phone: string;
  city: string | null;
  country_code: string | null;
  website_url: string | null;
  has_website: boolean;
  source: Exclude<LeadSource, "scraped">;
}

/** Best-effort E.164 normalization. Bare 10-digit numbers assume NANP (+1). */
export function normalizePhone(raw: string | undefined | null, defaultCc = "1"): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCc}${digits}`;
  return `+${digits}`;
}

export function validateLeadInput(
  raw: RawLead,
  source: Exclude<LeadSource, "scraped">,
  defaultCc = "1",
): { ok: true; lead: LeadInput } | { ok: false; error: string } {
  const phone = normalizePhone(raw.phone, defaultCc);
  if (!phone) return { ok: false, error: "missing or invalid phone" };
  const website = raw.website_url?.trim() || null;
  return {
    ok: true,
    lead: {
      business_name: raw.business_name?.trim() || "Unknown business",
      phone,
      city: raw.city?.trim() || null,
      country_code: raw.country_code?.trim().toLowerCase() || null,
      website_url: website,
      has_website: Boolean(website),
      source,
    },
  };
}

export function dedupeKey(lead: { phone: string }): string {
  return lead.phone;
}

export interface LeadRow {
  batch_id: string;
  business_name: string;
  phone: string;
  address: string | null;
  country_code: string | null;
  website_url: string | null;
  has_website: boolean;
  source: LeadSource;
  call_segment: CallSegment | null;
  stage: string;
}

/**
 * Map a validated LeadInput to a leads-table row under an import batch.
 * No-website imports get call_segment='no_website'; website-bearing imports leave it
 * null (not audited here) — the operator's campaign segment selects the script.
 */
export function buildLeadRow(lead: LeadInput, importBatchId: string): LeadRow {
  return {
    batch_id: importBatchId,
    business_name: lead.business_name,
    phone: lead.phone,
    address: lead.city,
    country_code: lead.country_code,
    website_url: lead.website_url,
    has_website: lead.has_website,
    source: lead.source,
    call_segment: lead.has_website ? null : deriveSegment({ has_website: false }),
    stage: "scraped",
  };
}

/** Minimal RFC-4180-ish CSV parser: first row = headers, supports "quoted, fields". */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = splitCsvLines(text.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    return obj;
  });
}

function splitCsvLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Column mapping: target field → source CSV header. */
export interface CsvMapping {
  business_name?: string;
  phone: string;
  city?: string;
  country_code?: string;
  website_url?: string;
}

export function mapCsvRow(row: Record<string, string>, mapping: CsvMapping): RawLead {
  const pick = (key?: string) => (key ? row[key] : undefined);
  return {
    business_name: pick(mapping.business_name),
    phone: pick(mapping.phone),
    city: pick(mapping.city),
    country_code: pick(mapping.country_code),
    website_url: pick(mapping.website_url),
  };
}
