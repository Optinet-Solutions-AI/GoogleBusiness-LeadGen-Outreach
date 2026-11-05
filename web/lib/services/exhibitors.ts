/**
 * exhibitors.ts — the "conference exhibitors" lead source: conferences → exhibitor lists → NormalizedLead[].
 *
 * Inputs:  { country ('eu' or ISO-2), category, year, eventUrls (optional), limit, shouldStop }
 * Outputs: NormalizedLead[] with signal { type: 'exhibitor', meta: { event_name, event_url, booth, … } } + a run log
 * Used by: lib/pipeline/stage-1-scrape.ts when batch.scraper == 'exhibitors'
 *
 * Per event: an ExpoFP floor plan (public exhibitor data) beats everything; else the exhibitors page is read and
 * Gemini lists the companies. Bot-walled pages are reported and skipped, never bypassed. One company at several
 * shows is one lead (first show wins). Pure helpers (normalise, dedupe) are unit-tested.
 */
import "@/lib/server-guard";
import { getLogger } from "../logger";
import { expoFpSlugs, fetchExpoFpPlan, type ExpoFpPlan } from "./expofp";
import { extractExhibitors, readPage, type ExtractedExhibitor } from "./exhibitor-pages";
import { discoverEvents, type DiscoveredEvent } from "./openai-events";
import { classifyWebsite } from "../filters";
import type { NormalizedLead } from "./types";

const log = getLogger("exhibitors");

export const EXHIBITORS_MAX_PER_QUERY = 500;
export { EXHIBITOR_CATEGORIES } from "../data/exhibitor-categories";

export interface ExhibitorEvent {
  name: string;
  url: string;
  pages: string[];
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface ExhibitorRunLog {
  events: { name: string; url: string; source: "expofp" | "page" | "blocked" | "empty" | "error"; exhibitors: number; detail?: string }[];
  discovery_usd: number;
}

/** An operator-pasted link → an event stub (name from the host until a page tells us more). Pure. */
export function eventFromUrl(url: string): ExhibitorEvent {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  return { name: host.split(".")[0], url, pages: [url], city: null, country: null, start_date: null, end_date: null };
}

export function eventFromDiscovered(e: DiscoveredEvent): ExhibitorEvent | null {
  const pages = [e.floor_plan_url, e.exhibitors_url, e.website].filter((u): u is string => !!u);
  if (!pages.length) return null;
  return { name: e.name, url: e.website ?? pages[0], pages, city: e.city, country: e.country, start_date: e.start_date, end_date: e.end_date };
}

const key = (name: string) => name.toLowerCase().replace(/\b(ltd|limited|llc|gmbh|s\.?a\.?|s\.?r\.?l\.?|plc|inc|b\.?v\.?|ag|co|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** One exhibitor → a lead. Pure. */
export function normalizeExhibitor(
  x: { name: string; website: string | null; booth: string | null; country: string | null; description?: string | null; socials?: Record<string, string | undefined> },
  ev: ExhibitorEvent,
  ctx: { category: string; year: number; source_url: string },
): NormalizedLead {
  const website = x.website?.trim() || null;
  const kind = classifyWebsite(website);
  return {
    business_name: x.name.trim(),
    phone: null,
    address: null,
    category: ctx.category,
    rating: null,
    review_count: null,
    has_website: kind === "real",
    website,
    website_kind: kind,
    email: null,
    business_status: null,
    is_service_area_only: false,
    photos: [],
    reviews: [],
    place_id: null,
    latitude: null,
    longitude: null,
    country_code: x.country ? x.country.toLowerCase() : null,
    signal: {
      type: "exhibitor",
      date: ev.end_date ?? ev.start_date ?? null,
      source_url: ctx.source_url,
      meta: {
        event_name: ev.name,
        event_url: ev.url,
        event_city: ev.city,
        event_country: ev.country,
        event_start: ev.start_date,
        event_end: ev.end_date,
        booth: x.booth,
        category: ctx.category,
        year: ctx.year,
        description: x.description?.slice(0, 300) ?? null,
        socials: x.socials ?? null,
      },
    },
    raw: x,
  };
}

/** Same company at several shows → keep the first; count the rest. Pure. */
export function dedupeExhibitors(leads: NormalizedLead[]): { keep: NormalizedLead[]; dropped: number } {
  const seen = new Set<string>();
  const keep: NormalizedLead[] = [];
  let dropped = 0;
  for (const l of leads) {
    const k = key(l.business_name);
    if (!k || seen.has(k)) {
      dropped += 1;
      continue;
    }
    seen.add(k);
    keep.push(l);
  }
  return { keep, dropped };
}

function fromPlan(plan: ExpoFpPlan, ev: ExhibitorEvent, ctx: { category: string; year: number }): NormalizedLead[] {
  const event: ExhibitorEvent = { ...ev, name: plan.title ?? ev.name, start_date: ev.start_date ?? plan.start_date, end_date: ev.end_date ?? plan.end_date, url: plan.home_url ?? ev.url };
  const src = `https://${plan.slug}.expofp.com/`;
  return plan.exhibitors.map((e) => normalizeExhibitor({ name: e.name, website: e.website, booth: e.booths.join(", ") || null, country: null, description: e.description, socials: e.socials }, event, { ...ctx, source_url: src }));
}

function fromExtracted(rows: ExtractedExhibitor[], ev: ExhibitorEvent, ctx: { category: string; year: number; source_url: string }): NormalizedLead[] {
  return rows
    .filter((r) => r.role === "exhibitor" || r.role === "sponsor" || r.role === "partner" || r.role === "unknown")
    .map((r) => normalizeExhibitor({ name: r.company, website: r.website, booth: r.booth, country: r.country }, ev, ctx));
}

/** Read one event: ExpoFP first (via a plan link or a link found on its pages), then the pages with Gemini. */
async function readEvent(ev: ExhibitorEvent, ctx: { category: string; year: number }, run: ExhibitorRunLog): Promise<NormalizedLead[]> {
  const slugs = new Set(ev.pages.flatMap(expoFpSlugs));
  let blocked = 0;
  const reads: { url: string; text: string }[] = [];
  if (!slugs.size) {
    for (const url of ev.pages.slice(0, 3)) {
      const page = await readPage(url);
      if (page.blocked) {
        blocked += 1;
        continue;
      }
      for (const s of expoFpSlugs(page.html)) slugs.add(s);
      if (page.text) reads.push({ url, text: page.text });
    }
  }
  for (const slug of slugs) {
    try {
      const plan = await fetchExpoFpPlan(slug);
      if (plan.exhibitors.length) {
        const leads = fromPlan(plan, ev, ctx);
        run.events.push({ name: plan.title ?? ev.name, url: ev.url, source: "expofp", exhibitors: leads.length, detail: slug });
        return leads;
      }
    } catch (err) {
      log.warn({ slug, err: String(err).slice(0, 120) }, "exhibitors.expofp_failed");
    }
  }
  let best: NormalizedLead[] = [];
  for (const r of reads) {
    try {
      const rows = await extractExhibitors(r.text, ev.name);
      const leads = fromExtracted(rows, ev, { ...ctx, source_url: r.url });
      if (leads.length > best.length) best = leads;
    } catch (err) {
      log.warn({ url: r.url, err: String(err).slice(0, 120) }, "exhibitors.extract_failed");
    }
  }
  if (best.length) {
    run.events.push({ name: ev.name, url: ev.url, source: "page", exhibitors: best.length });
    return best;
  }
  if (blocked && !reads.length) {
    run.events.push({ name: ev.name, url: ev.url, source: "blocked", exhibitors: 0, detail: "site blocks automated visitors — paste its ExpoFP floor-plan link or import the list" });
  } else {
    run.events.push({ name: ev.name, url: ev.url, source: reads.length ? "empty" : "error", exhibitors: 0 });
  }
  return [];
}

export async function fetchExhibitors(o: {
  country: string;
  category: string;
  year: number;
  eventUrls?: string[];
  limit: number;
  shouldStop?: () => boolean;
}): Promise<{ leads: NormalizedLead[]; run: ExhibitorRunLog; duplicates: number }> {
  const run: ExhibitorRunLog = { events: [], discovery_usd: 0 };
  let events: ExhibitorEvent[] = [];
  for (const u of o.eventUrls ?? []) {
    try {
      events.push(eventFromUrl(u.trim()));
    } catch {
      run.events.push({ name: u, url: u, source: "error", exhibitors: 0, detail: "not a valid link" });
    }
  }
  if (!events.length) {
    const { events: found, usd } = await discoverEvents({ country: o.country, category: o.category, year: o.year });
    run.discovery_usd = usd;
    events = found.map(eventFromDiscovered).filter((e): e is ExhibitorEvent => !!e);
    log.info({ country: o.country, category: o.category, year: o.year, events: events.length, usd }, "exhibitors.discovered");
  }
  const ctx = { category: o.category, year: o.year };
  const all: NormalizedLead[] = [];
  for (const ev of events) {
    if (o.shouldStop?.()) break;
    if (all.length >= o.limit) break;
    const leads = await readEvent(ev, ctx, run);
    all.push(...leads);
  }
  const { keep, dropped } = dedupeExhibitors(all);
  const leads = keep.slice(0, Math.min(o.limit, EXHIBITORS_MAX_PER_QUERY));
  log.info({ events: events.length, exhibitors: all.length, kept: leads.length, duplicates: dropped, log: run.events }, "exhibitors.done");
  return { leads, run, duplicates: dropped };
}
