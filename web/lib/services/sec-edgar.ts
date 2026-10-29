/**
 * sec-edgar.ts — US public companies that filed a bankruptcy or a facility-closure 8-K.
 *
 * Inputs:  state (2-letter or "US"), signal ("bankruptcy" | "bankruptcy_closures"), windowDays, limit
 * Outputs: NormalizedLead[] with a `signal` block (type "bankruptcy" | "closure"), one per filing
 * Used by: lib/pipeline/stage-1-scrape.ts (scraper "sec")
 *
 * Source: SEC EDGAR public archive (no key). We read each day's form index, keep 8-K filings,
 * then read only the first few KB of each filing (its SGML header) for the item list and the
 * company's business address/phone. Item 1.03 = Bankruptcy or Receivership; Item 2.05 = Costs
 * Associated with Exit or Disposal Activities (closing a facility / line). SEC's fair-access
 * policy: declared User-Agent with a contact, ≤ 10 requests/second — we stay near 6/s.
 */
import { log } from "@/lib/logger";
import type { NormalizedLead } from "./types";

const ARCHIVE = "https://www.sec.gov/Archives";
const UA = process.env.SEC_USER_AGENT || "RateUp LeadGen ops@rateupdigital.com";
const MAX_WINDOW_DAYS = 30; // ~390 8-Ks per business day; keeps a run well inside the job timeout
const SPACING_MS = 160;

export class SecFeedError extends Error {}

export type SecSignal = "bankruptcy" | "bankruptcy_closures";

export interface IndexRow { company: string; cik: string; filed: string; path: string }

/** Parse a daily form.idx: keep plain 8-K rows. Pure. */
export function parseFormIndex(text: string): IndexRow[] {
  const out: IndexRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^8-K\s{2,}(.+?)\s{2,}(\d+)\s+(\d{8})\s+(edgar\/data\/\S+\.txt)\s*$/);
    if (m) out.push({ company: m[1].trim(), cik: m[2], filed: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6)}`, path: m[4] });
  }
  return out;
}

export interface FilingHeader {
  name: string | null;
  items: string[];
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

/** Parse the SGML header of an EDGAR submission. Pure. */
export function parseHeader(text: string): FilingHeader {
  const items = [...text.matchAll(/ITEM INFORMATION:\s*(.+)/g)].map((m) => m[1].trim());
  const biz = text.split(/BUSINESS ADDRESS:/)[1]?.split(/MAIL ADDRESS:|FORMER COMPANY:|<\/SEC-HEADER>/)[0] ?? "";
  const field = (block: string, key: string) => block.match(new RegExp(`${key}:\\s*(.+)`))?.[1].trim() ?? null;
  return {
    name: field(text, "COMPANY CONFORMED NAME"),
    items,
    street: field(biz, "STREET 1"),
    city: field(biz, "CITY"),
    state: field(biz, "STATE"),
    zip: field(biz, "ZIP"),
    phone: field(biz, "BUSINESS PHONE"),
  };
}

/** Which signal a filing's items carry, given the requested signal. Pure. */
export function signalFor(items: string[], signal: SecSignal): "bankruptcy" | "closure" | null {
  if (items.some((i) => /bankruptcy or receivership/i.test(i))) return "bankruptcy";
  if (signal === "bankruptcy_closures" && items.some((i) => /exit or disposal/i.test(i))) return "closure";
  return null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function toNormalizedLead(row: IndexRow, h: FilingHeader, type: "bankruptcy" | "closure"): NormalizedLead {
  const accession = row.path.split("/").pop()!.replace(/\.txt$/, "");
  const city = h.city ? titleCase(h.city) : null;
  const address = [h.street ? titleCase(h.street) : null, [city, h.state].filter(Boolean).join(", ") + (h.zip ? ` ${h.zip}` : "")]
    .filter((p) => p && p.trim())
    .join(", ") || null;
  const digits = (h.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return {
    business_name: h.name ?? row.company,
    phone: digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : null,
    address,
    category: type === "bankruptcy" ? "SEC 8-K: Bankruptcy or receivership" : "SEC 8-K: Exit or disposal (closure)",
    rating: null,
    review_count: null,
    has_website: false,
    website: null,
    website_kind: "none",
    email: null,
    business_status: "OPERATIONAL",
    is_service_area_only: false,
    photos: [],
    reviews: [],
    business_hours: null,
    place_id: `sec:${accession}`,
    latitude: null,
    longitude: null,
    raw: { row, header: h },
    signal: {
      type,
      date: row.filed,
      source_url: `${ARCHIVE}/${row.path}`,
      meta: { cik: row.cik, accession, filed: row.filed, items: h.items, state: h.state, company_raw: row.company },
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, range?: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(range ? { Range: range } : {}) }, signal: AbortSignal.timeout(20000) });
  return { status: res.status, text: res.ok || res.status === 206 ? await res.text() : "" };
}

export async function fetchSecFilings(input: {
  state: string;
  signal: SecSignal;
  windowDays: number;
  limit: number;
  now?: Date;
  /** Checked between filings; true = stop and return what was found so far. */
  shouldStop?: () => boolean;
}): Promise<NormalizedLead[]> {
  const state = input.state.trim().toUpperCase() || "US";
  const days = Math.min(Math.max(1, input.windowDays), MAX_WINDOW_DAYS);
  const now = input.now ?? new Date();
  const out: NormalizedLead[] = [];
  let scanned = 0;
  let indexesRead = 0;
  let refused = 0;
  for (let d = 0; d < days && out.length < input.limit && !input.shouldStop?.(); d++) {
    const day = new Date(now.getTime() - d * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const ymd = day.toISOString().slice(0, 10).replace(/-/g, "");
    const qtr = Math.floor(day.getUTCMonth() / 3) + 1;
    const idx = await get(`${ARCHIVE}/edgar/daily-index/${ymd.slice(0, 4)}/QTR${qtr}/form.${ymd}.idx`);
    await sleep(SPACING_MS);
    // EDGAR answers 403 (not 404) for an index that does not exist yet (today, holidays).
    if (idx.status === 403 || idx.status === 404 || idx.status === 429) {
      if (idx.status !== 404) refused++;
      continue;
    }
    if (!idx.text) continue;
    indexesRead++;
    for (const row of parseFormIndex(idx.text)) {
      if (out.length >= input.limit || input.shouldStop?.()) break;
      const head = await get(`${ARCHIVE}/${row.path}`, "bytes=0-7999");
      await sleep(SPACING_MS);
      scanned++;
      if (!head.text) continue;
      const h = parseHeader(head.text);
      const type = signalFor(h.items, input.signal);
      if (!type) continue;
      if (state !== "US" && (h.state ?? "").toUpperCase() !== state) continue;
      out.push(toNormalizedLead(row, h, type));
    }
  }
  if (indexesRead === 0 && refused > 0) {
    throw new SecFeedError("SEC refused every daily index; set SEC_USER_AGENT to \"Company contact@email\"");
  }
  log.info({ state, signal: input.signal, days, scanned, found: out.length }, "sec_edgar.done");
  return out;
}
