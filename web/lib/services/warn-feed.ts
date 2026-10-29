/**
 * warn-feed.ts — WARN Act closure/layoff notices (free public feed) as NormalizedLead[].
 *
 * Inputs:  state (2-letter or US), signal kind, window days, min employees, limit
 * Outputs: NormalizedLead[] with a `signal` block (no phone/website — enrichment finds those later)
 * Used by: lib/pipeline/stage-1-scrape.ts when batch.scraper == 'warn'
 *
 * Source: "WARN Feed" (approjects-warn-act-notices.static.hf.space), licensed CC BY 4.0 — credit
 * "WARN Feed" wherever shown (we put it in signal.source_url). Free; no key. Per-state CSV for a
 * state, streamed NDJSON archive for US. Node-only; reads no secrets so it carries no server guard.
 */

import { getLogger } from "../logger";
import { parseCsv } from "../leads/import";
import { retry } from "../retry";
import type { NormalizedLead } from "./types";

const log = getLogger("warn-feed");

export const WARN_BASE = "https://approjects-warn-act-notices.static.hf.space";
/** Safety cap per batch (feed is free; this just bounds a run). */
export const WARN_MAX_PER_QUERY = 500;

export class WarnFeedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WarnFeedError";
  }
}

export type WarnNotice = {
  id: string;
  state: string;
  company: string;
  company_canonical: string;
  company_dba: string;
  location: string;
  employees_affected: number | null;
  notice_date: string | null;
  effective_date: string | null;
  notice_type: string;
  first_seen: string;
};

/**
 * Closure vs layoff from the free-text label. NOTE: the brief's bare /permanent/ would misread the
 * common "Layoff Permanent" (CA etc.) as a closure, so 'permanent' only counts when the label has
 * no layoff/reduction wording. 'CL' is the bare code some states use. Blank labels (TX, FL, NJ...)
 * are unknowable and count as layoffs.
 */
export function isClosure(noticeType: string): boolean {
  const t = noticeType.trim();
  if (/clos|shut|cease/i.test(t) || /^cl$/i.test(t)) return true;
  return /permanent/i.test(t) && !/lay\s?off|reduc/i.test(t);
}

/** True when the notice's effective (else notice) date is no older than `windowDays`. Future dates count. */
export function inWindow(n: WarnNotice, windowDays: number, now: Date): boolean {
  const d = n.effective_date ?? n.notice_date;
  if (!d) return false;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return false;
  return t >= now.getTime() - windowDays * 86_400_000;
}

export function toNormalizedLead(n: WarnNotice): NormalizedLead {
  return {
    business_name: n.company_dba || n.company_canonical || n.company,
    phone: null,
    address: `${n.location}, ${n.state}`,
    category: n.notice_type,
    rating: null,
    review_count: null,
    has_website: false,
    website: null,
    website_kind: "none",
    business_status: "OPERATIONAL",
    is_service_area_only: false,
    photos: [],
    reviews: [],
    place_id: `warn:${n.id}`,
    latitude: null,
    longitude: null,
    signal: {
      type: isClosure(n.notice_type) ? "closure" : "layoff",
      date: n.effective_date ?? n.notice_date,
      source_url: `${WARN_BASE}/data/by-state/${n.state.toLowerCase()}.csv`,
      meta: {
        warn_id: n.id,
        state: n.state,
        location: n.location,
        notice_type: n.notice_type,
        notice_date: n.notice_date,
        employees_affected: n.employees_affected,
        company_raw: n.company,
        company_canonical: n.company_canonical,
      },
    },
    raw: n,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const strOrNull = (v: unknown): string | null => str(v) || null;

function coerce(r: Record<string, unknown>): WarnNotice | null {
  const id = str(r.id);
  const company = str(r.company);
  if (!id || !(company || str(r.company_canonical))) return null;
  const emp = str(r.employees_affected);
  const num = emp === "" ? null : Number(emp);
  return {
    id,
    state: str(r.state).toUpperCase(),
    company,
    company_canonical: str(r.company_canonical),
    company_dba: str(r.company_dba),
    location: str(r.location),
    employees_affected: num !== null && Number.isFinite(num) ? num : null,
    notice_date: strOrNull(r.notice_date),
    effective_date: strOrNull(r.effective_date),
    notice_type: str(r.notice_type),
    first_seen: str(r.first_seen),
  };
}

export interface FetchWarnInput {
  state: string;
  signal: "closures" | "closures_layoffs";
  windowDays: number;
  minEmployees: number;
  limit: number;
  now?: Date;
  /** Test hook: initial retry backoff. */
  retryDelayMs?: number;
}

async function get(url: string, retryDelayMs: number): Promise<Response> {
  return retry(
    async () => {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new WarnFeedError(`WARN Feed ${res.status} for ${url}`, res.status);
      return res;
    },
    {
      maxAttempts: 3,
      initialMs: retryDelayMs,
      // Retry network errors, 5xx and 429; a 4xx is final.
      retryOn: (e) => !(e instanceof WarnFeedError) || e.status === undefined || e.status >= 500 || e.status === 429,
    },
  );
}

export async function fetchWarnNotices(input: FetchWarnInput): Promise<NormalizedLead[]> {
  const now = input.now ?? new Date();
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new WarnFeedError(`Invalid WARN state "${input.state}"`);
  const limit = Math.min(Math.max(input.limit, 0), WARN_MAX_PER_QUERY);
  const delay = input.retryDelayMs ?? 1000;
  const out: NormalizedLead[] = [];

  const accept = (n: WarnNotice | null): n is WarnNotice => {
    if (!n) return false;
    if (state !== "US" && n.state !== state) return false;
    if (input.signal === "closures" && !isClosure(n.notice_type)) return false;
    if (!inWindow(n, input.windowDays, now)) return false;
    // Unknown headcount is kept (several states never publish it); only a known low count is dropped.
    if (n.employees_affected !== null && n.employees_affected < input.minEmployees) return false;
    return true;
  };

  if (limit === 0) return out;

  if (state !== "US") {
    const url = `${WARN_BASE}/data/by-state/${state.toLowerCase()}.csv`;
    const res = await get(url, delay);
    const rows = parseCsv(await res.text());
    for (const r of rows) {
      const n = coerce(r);
      if (accept(n)) {
        out.push(toNormalizedLead(n));
        if (out.length >= limit) break;
      }
    }
    log.info({ url, status: res.status, rows: rows.length, leads: out.length }, "warn.fetch");
    return out;
  }

  const url = `${WARN_BASE}/data/warn_notices.ndjson`;
  const res = await get(url, delay);
  if (!res.body) throw new WarnFeedError("WARN Feed NDJSON response had no body", res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let scanned = 0;
  const handle = (line: string): boolean => {
    if (!line.trim()) return false;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      return false; // skip a malformed line rather than abort the run
    }
    scanned++;
    const n = coerce(rec);
    if (accept(n)) out.push(toNormalizedLead(n));
    return out.length >= limit;
  };
  let done = false;
  while (!done) {
    const { value, done: d } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while (!done && (nl = buf.indexOf("\n")) >= 0) {
      done = handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (!done) handle(buf + dec.decode());
  else await reader.cancel().catch(() => undefined);
  log.info({ url, status: res.status, scanned, leads: out.length }, "warn.fetch");
  return out;
}
