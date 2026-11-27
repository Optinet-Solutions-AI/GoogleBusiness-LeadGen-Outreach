/**
 * stage-1-scrape.ts — Pull leads from the chosen scraper, filter, enrich, persist.
 *
 * Inputs:  batch row { id, niche, city, scraper, limit, ... }
 * Outputs: rows in `leads` with stage='enriched' (qualified) or 'scraped' (rejected)
 * Used by: lib/pipeline/orchestrator.ts
 *
 * Dispatch: batch.scraper picks the provider —
 *   - 'apify'         → services/apify.ts           (default; + emails & socials, no cap)
 *   - 'outscraper'    → services/outscraper.ts      (cap 500/query)
 *   - 'google_places' → services/google-places.ts   (cap 60/query)
 *   - 'warn'          → services/warn-feed.ts       (free closure notices; niche=signal, city=state)
 *   - 'trustpilot'    → services/trustpilot.ts      (low-rated businesses; niche=category, country_code, city optional)
 *   - 'tripadvisor'   → services/tripadvisor.ts     (low-rated places; niche=restaurants|hotels|attractions, city)
 *     Review sites: a profile already on a lead from an earlier batch only refreshes that lead (refound.ts), and the
 *     robot's real cost is added to the batch notices.
 *
 * Enrichment (qualified rows only):
 *   - brand_color from first photo (Vibrant). For Places, resolves the photo
 *     resource name to a redirect URL first (bills the Photos SKU, ~$0.007/lead).
 *   - Runs in parallel with concurrency=5 to avoid rate limits.
 *   - On any failure, brand_color stays null and the row still moves to
 *     stage='enriched' — downstream stages have a fallback hex.
 *
 * "Any" niche (settings.niches, 16 Nov 2026): one search per niche of the chosen category, the limit shared
 * between them (Apify: a single actor run); the same place found twice is kept once; no off-niche flag.
 *
 * Idempotency: (place_id, batch_id) unique constraint dedupes re-runs.
 */

import { getDb } from "../db";
import { qualifies } from "../filters";
import { getLogger } from "../logger";
import { routeOffer } from "../offers";
import { extractBrandColor, FALLBACK_HEX } from "../services/color-extractor";
import * as apify from "../services/apify";
import * as googlePlaces from "../services/google-places";
import { resolveLogo } from "../services/logo";
import * as outscraper from "../services/outscraper";
import { fetchWarnNotices, WarnFeedError } from "../services/warn-feed";
import { fetchSecFilings } from "../services/sec-edgar";
import { fetchExhibitors } from "../services/exhibitors";
import { searchTrustpilot } from "../services/trustpilot";
import { searchTripAdvisor, TRIPADVISOR_TYPES, type TripAdvisorType } from "../services/tripadvisor";
import { robotCapUsd } from "../pricing";
import { PLATFORM_LABEL } from "../review-sites";
import { chunk, splitRefound } from "./refound";
import { BatchSettingsSchema, batchAiCap } from "../batch-settings";
import { isWrongCountryLead } from "../geo-check";
import type { NormalizedLead, WebsiteKind } from "../services/types";
import { auditWebsite } from "../services/website-auditor";
import { reviewWebsite } from "../services/website-review";
import { reviewFields, type WebsiteReview } from "../leads/website-review";
import { SCORE_COLS, scoreFields, scoreLead } from "../leads/lead-score-run";
import { checkLink } from "../services/link-check";
import type { ScoreLead } from "../leads/lead-score";
import { BrainError } from "../services/openai-brain";
import { findCompanyWebsite, findWebsitePhone } from "../services/company-website";
import { findWebsiteContacts, findWebsiteEmail } from "../services/website-email";
import { lookupNotice, lookupSeenAt, profileWithAI } from "../services/openai-profile";
import { contactsFromProfile, keepProfileOnRow } from "./batch-ai-lookup";
import { getOpenAiHealth, OpenAiUnavailableError } from "../services/openai-health";
import { researchContacts } from "./contact-research";
import { aiNotices, mergeNotices, newAiRun, type AiRun, type BatchNotice } from "./ai-notices";
import { exhibitorNotice } from "./exhibitor-notice";
import { env } from "../config";

const ENRICH_CONCURRENCY = 5;

const log = getLogger("stage-1");

export interface Batch {
  id: string;
  niche: string;
  city: string;
  scraper: "apify" | "google_places" | "outscraper" | "warn" | "sec" | "exhibitors" | "trustpilot" | "tripadvisor";
  limit: number | null;
  template_slug: string;
  /** ISO 3166-1 alpha-2 (lowercase). Optional for legacy rows that predate
   *  migration 008 — defaults to 'us'. */
  country_code?: string | null;
  /** Per-batch source options (WARN window/min employees). Null on legacy rows. */
  settings?: unknown;
}

type Scraper = Batch["scraper"];

/** What the operator asked a running batch to do (read from batches.stop_requested by the runner). */
export type StopKind = "pause" | "cancel";
export interface RunControl {
  stopRequested(): StopKind | null;
  /** Live progress for the batch page (lib/progress.ts; the orchestrator saves it, at most every 2 s). */
  report?(step: "search" | "check" | "save", line: string, done?: number, total?: number): void;
}
export interface Stage1Result {
  accepted: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
  /** Set when the run stopped early on the operator's request. */
  stopped: StopKind | null;
  /** Qualified leads saved but not enriched yet (a resumed batch enriches them). */
  pending_enrich: number;
}

/**
 * Keep the earliest-dated notice per company_canonical (case-insensitive); the
 * rest are duplicates (re-notices). Leads without a canonical name (Google
 * leads) always stay. Pure.
 */
export function dedupeByCompany(leads: NormalizedLead[]): {
  keep: NormalizedLead[];
  drop: NormalizedLead[];
} {
  const keyOf = (l: NormalizedLead): string | null => {
    const c = l.signal?.meta?.company_canonical;
    return typeof c === "string" && c.trim() ? c.trim().toLowerCase() : null;
  };
  const best = new Map<string, NormalizedLead>();
  for (const l of leads) {
    const k = keyOf(l);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || (l.signal?.date ?? "9999") < (cur.signal?.date ?? "9999")) best.set(k, l);
  }
  const keep: NormalizedLead[] = [];
  const drop: NormalizedLead[] = [];
  for (const l of leads) {
    const k = keyOf(l);
    if (!k || best.get(k) === l) keep.push(l);
    else drop.push(l);
  }
  return { keep, drop };
}

/** Pure mapping of a scraped lead to its `leads` row (shared by qualified + rejected rows). */
/** True when the scraper reports the place in a different country than the batch. Pure. */
export function isWrongCountry(lead: { country_code?: string | null; address?: string | null }, region: string): boolean {
  if (lead.country_code) return lead.country_code.toLowerCase() !== region.toLowerCase();
  // No country from the scraper: fall back to the address ("…, Rome, GA 30165" in an Italy batch).
  return isWrongCountryLead({ address: lead.address, country_code: region });
}

export function rowFromNormalized(
  lead: NormalizedLead,
  ctx: { batchId: string; region: string; categoryOffNiche?: boolean },
): Record<string, unknown> {
  return {
    batch_id: ctx.batchId,
    business_name: lead.business_name,
    phone: lead.phone,
    address: lead.address,
    category: lead.category,
    rating: lead.rating,
    review_count: lead.review_count,
    has_website: lead.has_website,
    website_url: lead.website,
    website_kind: lead.website_kind,
    // Apify supplies a contact email at scrape time (crawled from the site); other scrapers don't.
    email: lead.email ?? null,
    business_status: lead.business_status,
    is_service_area_only: lead.is_service_area_only,
    // Soft flag: Google's category didn't match the searched niche. Not a
    // reject; surfaced as a dashboard badge for operator review.
    category_off_niche: ctx.categoryOffNiche ?? false,
    // Default on EVERY row so the bulk upsert's key-union doesn't fill this
    // NOT-NULL column with NULL for non-audited leads. enrichOne overwrites
    // it with real issue codes when a website is audited.
    website_issues: [],
    photos: lead.photos,
    reviews: lead.reviews,
    business_hours: lead.business_hours ?? null,
    place_id: lead.place_id,
    latitude: lead.latitude,
    longitude: lead.longitude,
    // Denormalize the batch's country onto each lead; a batch is single-country.
    country_code: ctx.region,
    // Signal columns (WARN closures etc.); null for Google-Maps leads.
    signal_type: lead.signal?.type ?? null,
    signal_date: lead.signal?.date ?? null,
    signal_source_url: lead.signal?.source_url ?? null,
    signal_meta: lead.signal?.meta ?? null,
    stage: "scraped",
  };
}

export async function run(batch: Batch, ctl?: RunControl): Promise<Stage1Result> {
  const limit = batch.limit ?? 100;
  const isWarn = batch.scraper === "warn";
  // No city → country-wide search (the actor/API is pinned to the batch country).
  const searchFor = (term: string) => (batch.city?.trim() ? `${term} in ${batch.city}` : term);
  const query = searchFor(batch.niche);
  // Bias the scrape to the batch's country. Places wants lowercase ISO,
  // Outscraper expects uppercase; handle both shapes here.
  const region = (batch.country_code ?? "us").toLowerCase();
  const settings = BatchSettingsSchema.parse(batch.settings ?? {});
  // "Any" niche: every niche of the chosen category, the limit shared between them.
  const anyQueries = settings.niches.map(searchFor);
  const isAny = anyQueries.length > 0;
  log.info({ batch_id: batch.id, query, niches: settings.niches.length, limit, scraper: batch.scraper, region }, "stage_1.start");
  ctl?.report?.("search", isAny ? `searching ${anyQueries.length} niches (${batch.niche})…` : `searching for "${query}"…`);

  let raw: NormalizedLead[];
  // Review sites: what the robot returned and charged, for the batch notice.
  let robotRun: { label: string; found: number; usageUsd: number | null; cutShort: boolean } | null = null;
  if (batch.scraper === "apify") {
    // Cancel aborts the paid run; Pause lets the scrape finish and holds before enrichment.
    // An "Any" batch is still ONE actor run (searchStringsArray), so it costs the same per lead.
    raw = await apify.searchGoogleMaps({ query, queries: isAny ? anyQueries : undefined, limit, region, shouldStop: () => ctl?.stopRequested() === "cancel" });
  } else if (batch.scraper === "outscraper" || batch.scraper === "google_places") {
    // One search per niche, each with its share of the limit.
    const qs = isAny ? anyQueries : [query];
    const share = Math.max(1, Math.ceil(limit / qs.length));
    raw = [];
    for (const q of qs) {
      if (ctl?.stopRequested() === "cancel") break;
      raw.push(
        ...(batch.scraper === "outscraper"
          ? await outscraper.searchGoogleMaps({ query: q, limit: share, region: region.toUpperCase() })
          : await googlePlaces.searchText({ query: q, limit: share, region })),
      );
    }
    raw = raw.slice(0, limit);
  } else if (isWarn) {
    if (batch.niche !== "closures" && batch.niche !== "closures_layoffs") {
      throw new WarnFeedError(`WARN batch niche must be closures or closures_layoffs, got "${batch.niche}"`);
    }
    const state = (batch.city ?? "").trim().toUpperCase() || "US";
    if (!/^[A-Z]{2}$/.test(state)) {
      throw new WarnFeedError(`WARN batch city must be a 2-letter state or US, got "${batch.city}"`);
    }
    raw = await fetchWarnNotices({
      state,
      signal: batch.niche,
      windowDays: settings.window_days,
      minEmployees: settings.min_employees,
      limit,
    });
  } else if (batch.scraper === "sec") {
    if (batch.niche !== "bankruptcy" && batch.niche !== "bankruptcy_closures") {
      throw new Error(`SEC batch niche must be bankruptcy or bankruptcy_closures, got "${batch.niche}"`);
    }
    raw = await fetchSecFilings({
      state: batch.city ?? "",
      signal: batch.niche,
      windowDays: settings.window_days,
      limit,
      shouldStop: () => ctl?.stopRequested() === "cancel",
    });
  } else if (batch.scraper === "exhibitors") {
    // Companies with a stand at conferences (workflows/run_exhibitor_batch.md): niche = category,
    // city = country code or EU, settings.event_urls = pasted conference links (else OpenAI discovery).
    const country = ((batch.city ?? "").trim() || region || "eu").toLowerCase();
    const found = await fetchExhibitors({
      country,
      category: batch.niche,
      year: settings.year,
      eventUrls: settings.event_urls,
      limit,
      shouldStop: () => ctl?.stopRequested() === "cancel",
    }).catch((err: unknown) => {
      // Finding the shows needs OpenAI when no links were pasted: say so in words the operator can act on.
      if (err instanceof OpenAiUnavailableError) {
        throw new Error(
          `Couldn't find conferences: ${err.state === "no_credit" ? "the OpenAI account is out of credit" : err.state === "missing" ? "no OpenAI key is set" : "the OpenAI key was refused (expired or wrong)"}. ` +
            "Fix OpenAI, or paste the conference links (exhibitor page or ExpoFP floor plan) in the batch form and run it again.",
        );
      }
      throw err;
    });
    raw = found.leads;
    log.info({ batch_id: batch.id, events: found.run.events, duplicates: found.duplicates, discovery_usd: found.run.discovery_usd }, "stage_1.exhibitors");
    // Say on the batch page which shows were read and why each gave nothing — a "done, 0 leads" is never silent.
    await addBatchNotice(
      batch.id,
      exhibitorNotice({ run: found.run, country, category: batch.niche, kept: found.leads.length, duplicates: found.duplicates }),
    );
  } else if (batch.scraper === "trustpilot") {
    // Low-rated businesses on Trustpilot (workflows/run_review_site_batch.md): niche = Trustpilot category id,
    // country = the batch country, city = optional narrower location. The robot filters the rating itself.
    const found = await searchTrustpilot({
      category: batch.niche,
      country: region,
      city: batch.city,
      settings,
      limit,
      maxChargeUsd: robotCapUsd("trustpilot", limit),
      shouldStop: () => ctl?.stopRequested() === "cancel",
    });
    raw = found.leads;
    robotRun = { label: PLATFORM_LABEL.trustpilot, found: found.found, usageUsd: found.usageUsd, cutShort: found.cutShort };
  } else if (batch.scraper === "tripadvisor") {
    const type = batch.niche as TripAdvisorType;
    if (!TRIPADVISOR_TYPES.includes(type)) {
      throw new Error(`TripAdvisor batch niche must be ${TRIPADVISOR_TYPES.join(", ")}, got "${batch.niche}"`);
    }
    if (!batch.city?.trim()) throw new Error("TripAdvisor batches need a city.");
    const found = await searchTripAdvisor({
      city: batch.city,
      category: type,
      settings,
      limit,
      maxChargeUsd: robotCapUsd("tripadvisor", limit),
      shouldStop: () => ctl?.stopRequested() === "cancel",
    });
    raw = found.leads;
    robotRun = { label: PLATFORM_LABEL.tripadvisor, found: found.found, usageUsd: found.usageUsd, cutShort: found.cutShort };
  } else {
    throw new Error(`unknown scraper: ${batch.scraper}`);
  }
  const isReviewSite = batch.scraper === "trustpilot" || batch.scraper === "tripadvisor";
  const isSignalSource = isWarn || batch.scraper === "sec" || batch.scraper === "exhibitors" || isReviewSite;

  // An "Any" batch can find the same place under two niches (a locksmith that's also a "key cutter"): keep one.
  if (isAny || isReviewSite) raw = dedupeByPlace(raw);

  // Re-notices of one company: keep the earliest, persist the rest as rejected.
  const { drop } = dedupeByCompany(raw);
  const dropSet = new Set(drop);

  const rows: Record<string, unknown>[] = [];
  for (const lead of raw) {
    // Safety net: the scraper is pinned to the batch country, but a place it reports in
    // another country ("x in Murcia" → New Jersey) is never a lead for this batch.
    if (isWrongCountry(lead, region)) {
      rows.push({
        ...rowFromNormalized(lead, { batchId: batch.id, region }),
        qualified: false,
        rejection_reason: `wrong_country: ${lead.country_code ?? "address"}`,
      });
      continue;
    }
    if (dropSet.has(lead)) {
      rows.push({
        ...rowFromNormalized(lead, { batchId: batch.id, region }),
        qualified: false,
        rejection_reason: "duplicate_company",
      });
      continue;
    }
    const { passes, reason, detail, category_off_niche } = qualifies(
      {
        has_website: lead.has_website,
        rating: lead.rating,
        review_count: lead.review_count,
        phone: lead.phone,
        email: lead.email ?? null,
        category: lead.category,
        business_name: lead.business_name,
        business_status: lead.business_status,
        signal_type: lead.signal?.type ?? null,
        signal_date: lead.signal?.date ?? null,
        signal_meta: lead.signal
          ? { employees_affected: (lead.signal.meta.employees_affected as number | null | undefined) ?? null }
          : null,
      },
      // "Any" batches searched many niches, so there is no single niche to compare Google's category with.
      isSignalSource || isAny ? null : batch.niche,
      { minEmployees: settings.min_employees },
    );

    // Rejected leads get persisted too (qualified=false) so the operator can
    // see WHY each lead was rejected instead of just a count.
    const baseRow = rowFromNormalized(lead, {
      batchId: batch.id,
      region,
      categoryOffNiche: category_off_niche,
    });

    if (!passes) {
      const key = reason ?? "unknown";
      log.debug({ reason, detail, name: lead.business_name }, "stage_1.reject");
      rows.push({
        ...baseRow,
        qualified: false,
        rejection_reason: detail ? `${key}: ${detail}` : key,
        // Rejected leads stay at stage='scraped' but qualified=false guards
        // them out of every downstream pipeline stage (build, outreach…).
      });
      continue;
    }

    rows.push({ ...baseRow, qualified: true, rejection_reason: null });
  }

  // Review sites: a profile already on a lead from an earlier batch refreshes that lead instead of adding a second one.
  if (isReviewSite) {
    const { insert, refreshed, lookupFailed } = await refreshRefound(rows, batch.id);
    rows.splice(0, rows.length, ...insert);
    await saveRobotNotice(batch.id, robotRun, rows.filter((r) => r.qualified === true).length, refreshed, lookupFailed);
  }

  // Tally now: enrichment never changes whether a lead qualifies.
  const { accepted, rejected, rejection_reasons } = tallyRows(rows);
  ctl?.report?.(
    accepted ? "check" : "save",
    accepted
      ? `found ${accepted + rejected} businesses: ${accepted} worth checking${rejected ? `, ${rejected} left out` : ""}…`
      : `found ${accepted + rejected} businesses, none worth contacting`,
    0,
    accepted,
  );

  // Save every lead first (stage='scraped'), so a pause / cancel / crash during enrichment keeps them.
  await persistRows(rows);

  // Enrich qualified rows: website audit + offer routing + brand_color + logo, then stage='enriched'. The
  // audit sets needs_improvement/website_score which feeds routeOffer → call_segment. Healthy real-website
  // leads are kept as segment='has_website'. No network calls for rejected rows.
  const qualifiedRows = rows.filter((r) => r.qualified === true);
  let pending = qualifiedRows.length;
  if (qualifiedRows.length && !ctl?.stopRequested()) {
    log.info({ count: qualifiedRows.length }, "stage_1.enrich_start");
    const aiCap = batchAiCap(env.CONTACT_AI_MAX_PER_BATCH, batch.settings);
    // Each lead is saved as soon as it's checked, so the batch page's table fills in while the batch runs (the save of
    // all of them below stays the final word). A failed early save is only logged.
    const savedEarly = new WeakSet<object>();
    const saveEach = async (row: Record<string, unknown>) => {
      try {
        await persistRows([row]);
        savedEarly.add(row);
      } catch (err) {
        log.warn({ err: String(err).slice(0, 200) }, "stage_1.early_save_failed");
      }
    };
    const { rows: enriched, ai } = await enrichInParallel(qualifiedRows, batch.scraper, region, ctl, saveEach, aiCap);
    ctl?.report?.("save", `saving ${enriched.length} checked lead${enriched.length === 1 ? "" : "s"}…`);
    // Only the leads whose early save failed: saving the rest again would undo what the operator did to them meanwhile
    // (an email sent, AI Lookup, an edit) while the table filled in.
    const rest = stillToSave(enriched, savedEarly);
    if (rest.length) await persistRows(rest);
    await saveAiNotices(batch.id, ai, aiCap, aiCap === 0 && env.CONTACT_AI_MAX_PER_BATCH > 0);
    pending -= enriched.length;
    log.info({ count: enriched.length, pending }, "stage_1.enrich_done");
  }
  const stopped = pending > 0 ? (ctl?.stopRequested() ?? null) : null;

  log.info({ batch_id: batch.id, accepted, rejected, rejection_reasons, stopped, pending }, "stage_1.done");
  return { accepted, rejected, rejection_reasons, stopped, pending_enrich: pending };
}

/** Accepted / rejected counts and the rejection breakdown (bare reason key, ": detail" stripped). Pure. */
export function tallyRows(rows: Record<string, unknown>[]): {
  accepted: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
} {
  let accepted = 0;
  let rejected = 0;
  const rejection_reasons: Record<string, number> = {};
  for (const row of rows) {
    if (row.qualified === true) {
      accepted += 1;
    } else {
      rejected += 1;
      const key = ((row.rejection_reason as string | null) ?? "unknown").split(":")[0].trim();
      rejection_reasons[key] = (rejection_reasons[key] ?? 0) + 1;
    }
  }
  return { accepted, rejected, rejection_reasons };
}

async function persistRows(rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  let { error } = await getDb().from("leads").upsert(rows, { onConflict: "place_id,batch_id" });
  // Migration 052/053 not applied yet: save without the contact columns rather than lose the batch.
  // Up to three tries: 076 missing drops only the score columns, 069 only the website-check ones; an older gap drops the contact ones too.
  let saveRows = rows;
  for (let i = 0; i < 4 && error && missingContactColumn(error.message); i++) {
    log.warn({ err: error.message }, "stage_1.persist.columns_missing (migrations 052/053/061/069/076 applied?)");
    const strip = withoutMissing(error.message);
    saveRows = saveRows.map(strip);
    ({ error } = await getDb().from("leads").upsert(saveRows, { onConflict: "place_id,batch_id" }));
  }
  if (error) throw new Error(`stage_1.persist.error: ${error.message}`);
}

/**
 * Resume a paused batch: enrich its qualified leads still at stage='scraped' (no new scrape, no paid call).
 * Each lead is saved as soon as it is enriched, so another pause loses nothing.
 */
export async function resumeEnrichment(
  batch: Batch,
  ctl?: RunControl,
): Promise<{ enriched: number; pending: number; stopped: StopKind | null }> {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("*")
    .eq("batch_id", batch.id)
    .eq("qualified", true)
    .eq("stage", "scraped");
  if (error) throw new Error(`stage_1.resume.read: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  const region = (batch.country_code ?? "us").toLowerCase();
  log.info({ batch_id: batch.id, count: rows.length }, "stage_1.resume_start");
  const resumeCap = batchAiCap(env.CONTACT_AI_MAX_PER_BATCH, batch.settings);
  // Leads this batch already scored before the pause count against its lead-score budget (none / error = 0).
  const { count: scoredAlready } = await db.from("leads").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).not("lead_score", "is", null);
  // The page shows the resumed run at once (not the paused run's "Stopped …" until the first lead is checked).
  ctl?.report?.("check", `resuming: checking websites and researching contacts… 0 of ${rows.length}`, 0, rows.length);
  const { rows: enriched, ai } = await enrichInParallel(rows, batch.scraper, region, ctl, async (row) => {
    const { id, ...fields } = row;
    let saveFields: Record<string, unknown> = fields;
    let { error: uErr } = await db.from("leads").update(saveFields).eq("id", id as string);
    for (let i = 0; i < 4 && uErr && missingContactColumn(uErr.message); i++) {
      saveFields = withoutMissing(uErr.message)(saveFields);
      ({ error: uErr } = await db.from("leads").update(saveFields).eq("id", id as string));
    }
    if (uErr) log.warn({ lead_id: id, err: uErr.message }, "stage_1.resume.save_failed");
  }, resumeCap, scoredAlready ?? 0);
  await saveAiNotices(batch.id, ai, resumeCap, resumeCap === 0 && env.CONTACT_AI_MAX_PER_BATCH > 0);
  const pending = rows.length - enriched.length;
  const stopped = pending > 0 ? (ctl?.stopRequested() ?? null) : null;
  log.info({ batch_id: batch.id, enriched: enriched.length, pending, stopped }, "stage_1.resume_done");
  return { enriched: enriched.length, pending, stopped };
}

/**
 * Mutate each qualified row: website audit + offer routing, then (unless the
 * audit demoted it) brand_color + logo + stage='enriched'. Concurrency-limited
 * so we don't hammer the Places Photos endpoint or launch too many headless
 * pages at once. Failures are swallowed — the row still graduates with a
 * null brand_color (downstream uses FALLBACK_HEX).
 */
async function enrichInParallel(
  rows: Record<string, unknown>[],
  scraper: Scraper,
  countryCode: string,
  ctl?: RunControl,
  onEnriched?: (row: Record<string, unknown>) => Promise<void>,
  aiCap: number = env.CONTACT_AI_MAX_PER_BATCH,
  scoredAlready = 0,
): Promise<{ rows: Record<string, unknown>[]; ai: AiRun }> {
  const queue = [...rows];
  const done: Record<string, unknown>[] = [];
  // One AI research budget per batch run (CONTACT_AI_MAX_PER_BATCH, or 0 when "Run AI Lookup" was unticked). Check
  // OpenAI once up front so a dead key turns into a visible batch notice instead of silently thinner results.
  const ai = newAiRun(aiCap);
  // The OpenAI website check (25 Nov 2026) has its own budget, WEBSITE_AI_MAX_PER_BATCH; off when OpenAI is down.
  const site: SiteRun = { left: env.WEBSITE_AI_MAX_PER_BATCH, used: 0, usd: 0, until: Date.now() + SITE_CHECK_BUDGET_MS };
  // The OpenAI lead score (27 Nov 2026) runs on the leads AI Lookup runs on: none when AI Lookup is off for this batch.
  const score: ScoreRun = { left: scoreBudget(aiCap, env.LEAD_SCORE_MAX_PER_BATCH, scoredAlready), used: 0, usd: 0, until: Date.now() + SITE_CHECK_BUDGET_MS };
  if ((ai.left > 0 || site.left > 0 || score.left > 0) && rows.length) {
    const health = await getOpenAiHealth().catch(() => null);
    if (health && health.state !== "ok") {
      ai.unavailable = health.state;
      site.left = 0;
      score.left = 0;
      log.warn({ state: health.state }, "stage_1.ai_research_unavailable");
    }
  }
  const workers = Array.from(
    { length: Math.min(ENRICH_CONCURRENCY, queue.length) },
    async () => {
      // Pause / cancel: finish the lead in hand, start no new one.
      while (queue.length && !ctl?.stopRequested()) {
        const row = queue.shift();
        if (!row) break;
        await enrichOne(row, scraper, countryCode, ai, site);
        await scoreRow(row, score);
        if (onEnriched) await onEnriched(row);
        done.push(row);
        const name = typeof row.business_name === "string" ? row.business_name.slice(0, 60) : "";
        ctl?.report?.("check", `checking websites and researching contacts… ${done.length} of ${rows.length}${name ? ` (${name})` : ""}`, done.length, rows.length);
      }
    },
  );
  await Promise.all(workers);
  if (ai.used) log.info({ lookups: ai.used, usd: Math.round(ai.usd * 1e4) / 1e4 }, "stage_1.ai_contacts_spend");
  if (site.used) log.info({ checks: site.used, usd: Math.round(site.usd * 1e4) / 1e4 }, "stage_1.website_ai_spend");
  if (score.used) log.info({ scored: score.used, usd: Math.round(score.usd * 1e4) / 1e4 }, "stage_1.lead_score_spend");
  return { rows: done, ai };
}

/** Save the batch's AI-research notices (migration 058). Never throws: a missing column only loses the notice. */
/**
 * Review sites: split off rows whose profile is already a lead in another batch, refresh those leads' rating /
 * review count / details, and return the rows to insert. A lookup failure keeps every row (worst case a duplicate).
 */
async function refreshRefound(
  rows: Record<string, unknown>[],
  batchId: string,
): Promise<{ insert: Record<string, unknown>[]; refreshed: number; lookupFailed: boolean }> {
  const ids = rows.map((r) => r.place_id).filter((p): p is string => typeof p === "string");
  if (!ids.length) return { insert: rows, refreshed: 0, lookupFailed: false };
  const db = getDb();
  // 40 ids per lookup: TripAdvisor ids are ~100 characters and the whole list rides in the request URL.
  const existing = new Map<string, string>();
  for (const part of chunk(ids, 40)) {
    const { data, error } = await db.from("leads").select("id,place_id").in("place_id", part).neq("batch_id", batchId);
    if (error) {
      log.warn({ batch_id: batchId, err: error.message }, "stage_1.refound_lookup_failed");
      return { insert: rows, refreshed: 0, lookupFailed: true };
    }
    for (const l of (data ?? []) as { id: string; place_id: string }[]) existing.set(l.place_id, l.id);
  }
  const { insert, refresh } = splitRefound(rows, existing);
  for (const r of refresh) {
    const { error: uErr } = await db.from("leads").update(r.patch).eq("id", r.id);
    if (uErr) log.warn({ lead_id: r.id, err: uErr.message }, "stage_1.refound_refresh_failed");
  }
  log.info({ batch_id: batchId, refreshed: refresh.length, new: insert.length }, "stage_1.refound");
  return { insert, refreshed: refresh.length, lookupFailed: false };
}

/** Review sites: tell the operator what the robot found and really charged (batches.notices, migration 058). */
async function saveRobotNotice(
  batchId: string,
  run: { label: string; found: number; usageUsd: number | null; cutShort: boolean } | null,
  kept: number,
  refreshed: number,
  lookupFailed = false,
): Promise<void> {
  if (!run) return;
  const cost = run.usageUsd == null ? "cost not reported" : `cost $${run.usageUsd.toFixed(3)}`;
  const again = lookupFailed
    ? " (couldn't check earlier batches, so some may be duplicates)"
    : refreshed
      ? `, ${refreshed} already known (rating refreshed)`
      : "";
  const early = run.cutShort ? " It stopped early (time limit, spending cap or cancel), so there may be more to find." : "";
  const notice = `${run.label} robot: ${run.found} found, ${kept} new leads kept${again}, ${cost}.${early}`;
  try {
    const db = getDb();
    const { data } = await db.from("batches").select("notices").eq("id", batchId).maybeSingle();
    const { error } = await db
      .from("batches")
      .update({ notices: mergeNotices((data as { notices?: unknown } | null)?.notices, [{ level: "info", text: notice }]) })
      .eq("id", batchId);
    if (error) log.warn({ batch_id: batchId, err: error.message }, "stage_1.robot_notice_failed");
  } catch (err) {
    log.warn({ batch_id: batchId, err: String(err) }, "stage_1.robot_notice_failed");
  }
}

/** Add one notice to the batch (batches.notices, migration 058). Never throws: a failed save only loses the notice. */
async function addBatchNotice(batchId: string, notice: BatchNotice): Promise<void> {
  try {
    const db = getDb();
    const { data } = await db.from("batches").select("notices").eq("id", batchId).maybeSingle();
    const { error } = await db
      .from("batches")
      .update({ notices: mergeNotices((data as { notices?: unknown } | null)?.notices, [notice]) })
      .eq("id", batchId);
    if (error) log.warn({ batch_id: batchId, err: error.message }, "stage_1.notice_save_failed");
  } catch (err) {
    log.warn({ batch_id: batchId, err: String(err) }, "stage_1.notice_save_failed");
  }
}

async function saveAiNotices(batchId: string, ai: AiRun, cap: number, unticked: boolean): Promise<void> {
  const add = aiNotices(ai, cap, { unticked });
  if (!add.length) return;
  try {
    const db = getDb();
    const { data } = await db.from("batches").select("notices").eq("id", batchId).maybeSingle();
    const { error } = await db
      .from("batches")
      .update({ notices: mergeNotices((data as { notices?: unknown } | null)?.notices, add) })
      .eq("id", batchId);
    if (error) log.warn({ batch_id: batchId, err: error.message }, "stage_1.notices_save_failed (migration 058 applied?)");
  } catch (err) {
    log.warn({ batch_id: batchId, err: String(err) }, "stage_1.notices_save_failed");
  }
}

/** Lead columns added by migrations 052/053 — dropped from a save when the migration isn't applied yet. */
// + ai_profile / ai_profile_at (migration 061): the AI Lookup kept on each lead.
const CONTACT_EXTRA_COLS = ["contact_page_url", "contact_owner_name", "contact_owner_role", "contact_sources", "ai_profile", "ai_profile_at"];
/** The OpenAI website check (migration 069): dropped on its own, so a missing 069 never loses the AI Lookup results. */
const REVIEW_COLS = ["website_review", "website_reviewed_at"];
/** The lead score (migration 076): dropped on its own too, so a missing 076 never loses anything else. */
const SCORE_SAVE_COLS: readonly string[] = SCORE_COLS;
/** Does the contact page open (migration 080): dropped on its own. */
const LINK_COLS: readonly string[] = ["link_checks"];
const missingContactColumn = (msg: string) => [...CONTACT_EXTRA_COLS, ...REVIEW_COLS, ...SCORE_SAVE_COLS, ...LINK_COLS].some((c) => msg.includes(c));
/** What to drop for this missing-column error: only the 076 / 069 columns when that's what's missing, else every extra. */
/** The checked leads still to save at the end: the ones whose early save didn't go through. */
export function stillToSave<T extends object>(rows: T[], saved: WeakSet<object>): T[] {
  return rows.filter((r) => !saved.has(r));
}

export function withoutMissing(msg: string): (row: Record<string, unknown>) => Record<string, unknown> {
  const drop = LINK_COLS.some((c) => msg.includes(c))
    ? LINK_COLS
    : SCORE_SAVE_COLS.some((c) => msg.includes(c))
      ? SCORE_SAVE_COLS
      : CONTACT_EXTRA_COLS.some((c) => msg.includes(c))
        ? [...CONTACT_EXTRA_COLS, ...REVIEW_COLS, ...SCORE_SAVE_COLS, ...LINK_COLS]
        : REVIEW_COLS;
  return (row) => {
    const out = { ...row };
    for (const c of drop) delete out[c];
    return out;
  };
}

/** The batch's OpenAI website-check budget and spend; no new checks after `until` (keeps the job well inside its timeout). */
type SiteRun = { left: number; used: number; usd: number; until: number };
/** Website checks stop starting after this long in one batch run; later leads keep the free check (button re-checks). */
const SITE_CHECK_BUDGET_MS = 12 * 60_000;

/** The batch's lead-score budget and spend (LEAD_SCORE_MAX_PER_BATCH). */
type ScoreRun = { left: number; used: number; usd: number; until: number };

/**
 * How many leads this run may score: never more than AI Lookup may research (the estimate counts the smaller of the
 * two), less what a resumed batch already scored. 0 when AI Lookup is off for the batch.
 */
export function scoreBudget(aiCap: number, maxScore: number, scoredAlready: number): number {
  if (aiCap <= 0) return 0;
  return Math.max(0, Math.min(aiCap, maxScore) - Math.max(0, scoredAlready));
}

/**
 * The last step for each lead: the OpenAI lead score, once the website check, AI Lookup and the offer are on the row.
 * A failure never fails the lead; a dead key / no credit stops scoring for the rest of the batch.
 */
export async function scoreRow(row: Record<string, unknown>, score: ScoreRun): Promise<void> {
  // Rows are saved only after enrichment: past the time limit, later leads stay unscored (Score this batch covers them).
  if (score.left <= 0 || Date.now() >= score.until) return;
  score.left -= 1;
  try {
    const s = await scoreLead(row as unknown as ScoreLead);
    if (!s) return;
    Object.assign(row, scoreFields(s));
    score.used += 1;
    score.usd += s.usd;
  } catch (err) {
    if (err instanceof BrainError && (err.code === "key_invalid" || err.code === "no_credit" || err.code === "not_configured")) score.left = 0;
    log.warn({ err: String(err).slice(0, 200) }, "stage_1.lead_score_failed");
  }
}

/** Put an OpenAI website check on the row: its verdict decides has_website / needs_improvement (→ the pitch). */
function applyReview(row: Record<string, unknown>, review: WebsiteReview): void {
  Object.assign(row, reviewFields(review));
  row.website_review = review;
  row.website_reviewed_at = review.checked_at;
}

async function enrichOne(
  row: Record<string, unknown>,
  scraper: Scraper,
  countryCode: string,
  ai: AiRun = newAiRun(0),
  site: SiteRun = { left: 0, used: 0, usd: 0, until: 0 },
): Promise<void> {
  // ── Website audit + offer routing ──────────────────────────────────────
  // Only leads with a REAL website get audited; the audit sets
  // needs_improvement/website_score, which routeOffer uses to pick the segment
  // (healthy sites are KEPT as has_website, not dropped). No-website leads skip
  // the audit. routeOffer is pure.
  const hasWebsite = row.has_website === true;
  const isSignal = typeof row.signal_type === "string" && row.signal_type !== "";
  // Exhibitors are companies we pitch a booth to: find their site + contacts like any lead, but never audit/build.
  // Review-site leads (reputation offer) are researched the same way: the robot usually gives their website.
  const isExhibitor = row.signal_type === "exhibitor" || row.signal_type === "review_site";
  if (isExhibitor && !hasWebsite) {
    try {
      const site = await findCompanyWebsite(String(row.business_name ?? ""));
      if (site) {
        row.website_url = site;
        row.website_kind = "real";
        row.has_website = true;
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_1.exhibitor_site_failed");
    }
  }
  const exhibitorSite = isExhibitor && typeof row.website_url === "string" && row.website_url ? (row.website_url as string) : null;
  if (!isSignal && hasWebsite && typeof row.website_url === "string" && row.website_url) {
    try {
      const audit = await auditWebsite(row.website_url as string, {
        websiteKind: (row.website_kind as WebsiteKind | null) ?? null,
        countryCode,
      });
      row.website_score = audit.score;
      row.website_issues = audit.issues;
      row.needs_improvement = audit.needs_improvement;
      row.website_status = audit.status;
      row.audited_at = new Date().toISOString();
      // OpenAI looks at the homepage and decides No / Old / Good website (25 Nov 2026). Skipped for a parked or dead
      // site (the free check already knows); a failure keeps the free check's result.
      if (site.left > 0 && Date.now() < site.until && !audit.parked && audit.reachability !== "dead") {
        site.left -= 1;
        try {
          const review = await reviewWebsite({
            key: `${String(row.batch_id ?? "batch")}-${String(row.place_id ?? row.business_name ?? "site")}`,
            url: row.website_url as string,
            business_name: String(row.business_name ?? ""),
            category: (row.category as string | null) ?? null,
            city: (row.address as string | null) ?? null,
            country_code: countryCode,
          });
          if (review) {
            site.used += 1;
            site.usd += review.usd;
            applyReview(row, review);
          }
        } catch (err) {
          if (err instanceof OpenAiUnavailableError) site.left = 0;
          log.warn({ err: String(err).slice(0, 200) }, "stage_1.website_review_failed");
        }
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_1.audit_failed");
    }
  }

  // ── Contact research: AI first, then the business's own site (lib/pipeline/contact-research.ts) ──
  await researchContacts(
    row,
    {
      // Every lead type since 23 Nov 2026 (operator decision): closing businesses too, so they aren't left with no email.
      aiEligible: true,
      ownSite:
        ((!isSignal && hasWebsite) || exhibitorSite) && typeof row.website_url === "string" && row.website_url
          ? (row.website_url as string)
          : null,
      countryCode,
    },
    ai,
    {
      // The full AI Lookup (20 Nov 2026), same cost as the old contacts-only search: fills the same contact fields and
      // keeps the whole result on the lead for the research panel + the "Google vs AI Lookup" box.
      ai: async (b) => {
        const p = await profileWithAI({
          ...b,
          category: (row.category as string | null) ?? null,
          seen_at: lookupSeenAt(row.signal_type as string | null, row.signal_meta as Record<string, unknown> | null),
          notice: lookupNotice(row.signal_type as string | null, row.signal_meta as Record<string, unknown> | null),
        });
        keepProfileOnRow(row, p, new Date().toISOString());
        // A local business: a head-office / franchisor inbox is listed, never made the main email (23 Nov 2026).
        return contactsFromProfile(p, { ownOnly: !isSignal });
      },
      crawl: (url, cc) => findWebsiteContacts(url, cc, { render: false }),
    },
  );

  // Does the contact page we found actually open? One quick request, free (27 Nov 2026, migration 080). A social page
  // is never fetched (they block automated checks): it's marked "unchecked" for the operator to open.
  if (typeof row.contact_page_url === "string" && row.contact_page_url) {
    const check = await checkLink(row.contact_page_url).catch(() => null);
    if (check) row.link_checks = { contact_page: check };
  }

  // NOTE: stage-1 does NOT skip routing for offer_locked leads. The bulk upsert
  // can't conditionally omit columns without nulling them for other rows, and a
  // re-scrape over locked leads is rare. The lock IS honored by stage-2 /
  // regenerate / build-lead. Follow-up if batch re-scrapes become common.
  const route = routeOffer({
    // The website check may have found it isn't a real site after all (has_website false → offer a new one).
    has_website: row.has_website === true,
    needs_improvement: (row.needs_improvement as boolean | null) ?? null,
    signal_type: (row.signal_type as string | null) ?? null,
  });
  row.call_segment = route.segment;
  row.primary_offer = route.primary_offer;
  row.secondary_offer = route.secondary_offer;
  if (isSignal || route.segment === "has_website") {
    // Signal (liquidation) leads are never built: no color/logo/Photos calls.
    // Healthy real site → kept for the discovery/menu call. No build, so skip the
    // build-oriented color/logo enrichment. (Was previously demoted to qualified=false.)
    if (isSignal && !isExhibitor) await enrichSignalRow(row);
    row.stage = "enriched";
    return;
  }

  const photos = (row.photos as Array<{ name?: string; url?: string }> | undefined) ?? [];
  const first = photos[0];
  let src: string | null = first?.url ?? null;

  // Places returns photo resource names; resolve to a redirect URL.
  if (!src && first?.name && scraper === "google_places") {
    try {
      src = await googlePlaces.getPhotoUrl(first.name);
    } catch (err) {
      log.warn({ err: String(err) }, "stage_1.photo_resolve_failed");
    }
  }

  if (src) {
    try {
      row.brand_color = await extractBrandColor(src);
    } catch (err) {
      log.warn({ err: String(err) }, "stage_1.color_failed");
    }
  }

  // Resolve a logo (Brandfetch when real domain, monogram otherwise).
  // Never throws — monogram fallback handles every error path.
  try {
    const brandHex = (row.brand_color as string | undefined) ?? FALLBACK_HEX;
    const { logo_url } = await resolveLogo({
      business_name: row.business_name as string,
      website_url: (row.website_url as string | null) ?? null,
      website_kind: (row.website_kind as WebsiteKind | null) ?? null,
      brand_hex: brandHex,
      category: (row.category as string | null) ?? null,
    });
    row.logo_url = logo_url;
  } catch (err) {
    log.warn({ err: String(err) }, "stage_1.logo_failed");
  }

  row.stage = "enriched";
}

/** Liquidation (WARN) lead: find the company site by domain guess, then its email + phone. Free; never throws. */
async function enrichSignalRow(row: Record<string, unknown>): Promise<void> {
  try {
    const site = await findCompanyWebsite(String(row.business_name ?? ""));
    if (!site) return;
    row.website_url = site;
    row.website_kind = "real";
    if (!row.email) row.email = await findWebsiteEmail(site, "us").catch(() => null);
    if (!row.phone) row.phone = await findWebsitePhone(site).catch(() => null);
    log.info({ name: row.business_name, site, email: !!row.email, phone: !!row.phone }, "stage_1.signal_enriched");
  } catch (err) {
    log.warn({ err: String(err).slice(0, 200) }, "stage_1.signal_enrich_failed");
  }
}

/** Same Google place found by two searches → keep the first. Pure. */
export function dedupeByPlace(leads: NormalizedLead[]): NormalizedLead[] {
  const seen = new Set<string>();
  return leads.filter((l) => {
    const key = l.place_id || `${l.business_name.trim().toLowerCase()}|${(l.address ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
