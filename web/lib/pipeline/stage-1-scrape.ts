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
 *
 * Enrichment (qualified rows only):
 *   - brand_color from first photo (Vibrant). For Places, resolves the photo
 *     resource name to a redirect URL first (bills the Photos SKU, ~$0.007/lead).
 *   - Runs in parallel with concurrency=5 to avoid rate limits.
 *   - On any failure, brand_color stays null and the row still moves to
 *     stage='enriched' — downstream stages have a fallback hex.
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
import { BatchSettingsSchema } from "../batch-settings";
import type { NormalizedLead, WebsiteKind } from "../services/types";
import { auditWebsite } from "../services/website-auditor";
import { findCompanyWebsite, findWebsitePhone } from "../services/company-website";
import { findWebsiteEmail } from "../services/website-email";

const ENRICH_CONCURRENCY = 5;

const log = getLogger("stage-1");

export interface Batch {
  id: string;
  niche: string;
  city: string;
  scraper: "apify" | "google_places" | "outscraper" | "warn" | "sec";
  limit: number | null;
  template_slug: string;
  /** ISO 3166-1 alpha-2 (lowercase). Optional for legacy rows that predate
   *  migration 008 — defaults to 'us'. */
  country_code?: string | null;
  /** Per-batch source options (WARN window/min employees). Null on legacy rows. */
  settings?: unknown;
}

type Scraper = Batch["scraper"];

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

export async function run(batch: Batch): Promise<{
  accepted: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
}> {
  const limit = batch.limit ?? 100;
  const isWarn = batch.scraper === "warn";
  // No city → country-wide search (the actor/API is pinned to the batch country).
  const query = batch.city?.trim() ? `${batch.niche} in ${batch.city}` : batch.niche;
  // Bias the scrape to the batch's country. Places wants lowercase ISO,
  // Outscraper expects uppercase; handle both shapes here.
  const region = (batch.country_code ?? "us").toLowerCase();
  log.info({ batch_id: batch.id, query, limit, scraper: batch.scraper, region }, "stage_1.start");

  const settings = BatchSettingsSchema.parse(batch.settings ?? {});
  let raw: NormalizedLead[];
  if (batch.scraper === "apify") {
    raw = await apify.searchGoogleMaps({ query, limit, region });
  } else if (batch.scraper === "outscraper") {
    raw = await outscraper.searchGoogleMaps({ query, limit, region: region.toUpperCase() });
  } else if (batch.scraper === "google_places") {
    raw = await googlePlaces.searchText({ query, limit, region });
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
    raw = await fetchSecFilings({ state: batch.city ?? "", signal: batch.niche, windowDays: settings.window_days, limit });
  } else {
    throw new Error(`unknown scraper: ${batch.scraper}`);
  }

  // Re-notices of one company: keep the earliest, persist the rest as rejected.
  const { drop } = dedupeByCompany(raw);
  const dropSet = new Set(drop);

  const rows: Record<string, unknown>[] = [];
  for (const lead of raw) {
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
        category: lead.category,
        business_name: lead.business_name,
        business_status: lead.business_status,
        signal_type: lead.signal?.type ?? null,
        signal_date: lead.signal?.date ?? null,
        signal_meta: lead.signal
          ? { employees_affected: (lead.signal.meta.employees_affected as number | null | undefined) ?? null }
          : null,
      },
      isWarn || batch.scraper === "sec" ? null : batch.niche,
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

  // Enrich qualified rows in-place before upsert: website audit + offer
  // routing + brand_color + logo, then stage='enriched'. The audit sets
  // needs_improvement/website_score which feeds routeOffer → call_segment.
  // Healthy real-website leads are kept as segment='has_website' (no demotion
  // to qualified=false). Tally computed AFTER this pass. No network calls for
  // rejected rows.
  const qualifiedRows = rows.filter((r) => r.qualified === true);
  if (qualifiedRows.length) {
    log.info({ count: qualifiedRows.length }, "stage_1.enrich_start");
    await enrichInParallel(qualifiedRows, batch.scraper, region);
    log.info({ count: qualifiedRows.length }, "stage_1.enrich_done");
  }

  if (rows.length) {
    const { error } = await getDb()
      .from("leads")
      .upsert(rows, { onConflict: "place_id,batch_id" });
    if (error) throw new Error(`stage_1.persist.error: ${error.message}`);
  }

  // Final tally over all rows (post-audit-demotion).
  let accepted = 0;
  let rejected = 0;
  const rejection_reasons: Record<string, number> = {};
  for (const row of rows) {
    if (row.qualified === true) {
      accepted += 1;
    } else {
      rejected += 1;
      // Aggregate by the bare reason key (strip the ": detail" suffix).
      const raw = (row.rejection_reason as string | null) ?? "unknown";
      const key = raw.split(":")[0].trim();
      rejection_reasons[key] = (rejection_reasons[key] ?? 0) + 1;
    }
  }

  log.info({ batch_id: batch.id, accepted, rejected, rejection_reasons }, "stage_1.done");
  return { accepted, rejected, rejection_reasons };
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
): Promise<void> {
  const queue = [...rows];
  const workers = Array.from(
    { length: Math.min(ENRICH_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) break;
        await enrichOne(row, scraper, countryCode);
      }
    },
  );
  await Promise.all(workers);
}

async function enrichOne(
  row: Record<string, unknown>,
  scraper: Scraper,
  countryCode: string,
): Promise<void> {
  // ── Website audit + offer routing ──────────────────────────────────────
  // Only leads with a REAL website get audited; the audit sets
  // needs_improvement/website_score, which routeOffer uses to pick the segment
  // (healthy sites are KEPT as has_website, not dropped). No-website leads skip
  // the audit. routeOffer is pure.
  const hasWebsite = row.has_website === true;
  const isSignal = typeof row.signal_type === "string" && row.signal_type !== "";
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
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_1.audit_failed");
    }
  }

  // NOTE: stage-1 does NOT skip routing for offer_locked leads. The bulk upsert
  // can't conditionally omit columns without nulling them for other rows, and a
  // re-scrape over locked leads is rare. The lock IS honored by stage-2 /
  // regenerate / build-lead. Follow-up if batch re-scrapes become common.
  const route = routeOffer({
    has_website: hasWebsite,
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
    if (isSignal) await enrichSignalRow(row);
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
