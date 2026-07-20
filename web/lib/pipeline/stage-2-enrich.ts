/**
 * stage-2-enrich.ts — Re-enrich a single lead's brand_color (and later, email).
 *
 * Inputs:  lead row at stage='scraped' or 'enriched'
 * Outputs: same row updated with brand_color, email (if found), stage='enriched'
 * Used by: lib/pipeline/build-lead.ts (idempotent), /api/leads/:id/regenerate
 *
 * Note: Stage 1 now performs initial enrichment at scrape time, so most
 * leads already arrive here at stage='enriched' with brand_color set. This
 * stage is the re-enrichment path: forced regenerations, or leads scraped
 * before the stage-1 enrichment migration. Skips photo extraction if
 * brand_color is already set.
 *
 * Idempotent: re-running just overwrites brand_color / email.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import { routeOffer } from "../offers";
import { extractBrandColor, FALLBACK_HEX } from "../services/color-extractor";
import { getPhotoUrl, getPlacePhotos } from "../services/google-places";
import { resolveLogo } from "../services/logo";
import { findSocialUrl } from "../services/social-search";
import { findWebsiteEmail } from "../services/website-email";
import { extractWebsiteImages } from "../services/website-images";
import type { WebsiteKind } from "../services/types";
import { auditWebsite } from "../services/website-auditor";

const log = getLogger("stage-2");

export interface Lead {
  id: string;
  business_name: string;
  brand_color: string | null;
  email: string | null;
  photos: Array<{ name?: string; url?: string }>;
  /** Google Maps place id — used to re-fetch the real photo set (Apify only
   *  returns the cover image; Google itself usually has 8-10). */
  place_id?: string | null;
  batch_id: string;
  /** Optional context for logo resolution — populated by stage-1 onward. */
  category?: string | null;
  address?: string | null;
  website_url?: string | null;
  website_kind?: WebsiteKind | null;
  logo_url?: string | null;
  /** Offer-routing / audit context (migration 016). Backfilled here for leads
   *  scraped before the audit/offer split, or when offer_locked is false. */
  has_website?: boolean | null;
  website_score?: number | null;
  needs_improvement?: boolean | null;
  offer_locked?: boolean | null;
}

/** Extract the most-likely city token from a free-form address string.
 *  Example: "101 Colombo Street, Frankton, Hamilton 3204" → "Hamilton". */
function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Prefer the second-to-last segment when there are >=3 — that's typically
  // the city in "<street>, <suburb>, <city> <postcode>" patterns.
  const candidate = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
  // Strip trailing postcode/zip-like trailing digits.
  return candidate.replace(/\s+\d[\d\s-]*$/, "").trim() || null;
}

/** Quick check that a URL returns an actual image (status 2xx + image/* type).
 *  Drops dead/expired Google photo URLs that would render as a broken <img>.
 *  Checks headers only (no body read); any failure → false. */
async function urlServesImage(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    return r.ok && (r.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function run(
  lead: Lead,
): Promise<{ brand_color: string | null; email: string | null; logo_url: string | null }> {
  log.info({ lead_id: lead.id, name: lead.business_name }, "stage_2.start");

  // ── Real photos ──────────────────────────────────────────────────────────
  // Apify only ever returns the cover image, and Places-scraped leads store
  // photo *names* (not URLs). Re-fetch the real photo set by place_id and
  // resolve each to a usable URL so demos show THEIR actual photos, not stock.
  // Idempotent: skip the paid calls once we already hold several resolved URLs.
  let photos = lead.photos ?? [];
  const resolvedCount = photos.filter((p) => p.url && /^https?:\/\//.test(p.url)).length;
  if (resolvedCount < 4 && lead.place_id) {
    try {
      const names = await getPlacePhotos(lead.place_id, 8);
      const resolved: Array<{ url: string; name: string }> = [];
      for (const name of names) {
        try {
          const url = await getPhotoUrl(name, 1600);
          if (url) resolved.push({ url, name });
        } catch (err) {
          log.warn({ err: String(err).slice(0, 120) }, "stage_2.photo_resolve_one_failed");
        }
      }
      if (resolved.length) {
        photos = resolved;
        log.info({ lead_id: lead.id, count: resolved.length }, "stage_2.photos_resolved");
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_2.photos_fetch_failed");
    }
  }

  // Drop any photo whose URL no longer serves an image (expired / 400 / HTML) —
  // covers both freshly-resolved and previously-cached photos, so a dead URL
  // never renders as a broken <img>. Headers-only checks, run in parallel.
  if (photos.some((p) => p.url)) {
    const checks = await Promise.all(
      photos.map(async (p) => ({ p, ok: p.url ? await urlServesImage(p.url) : true })),
    );
    const valid = checks.filter((c) => c.ok).map((c) => c.p);
    if (valid.length !== photos.length) {
      log.info({ lead_id: lead.id, dropped: photos.length - valid.length, kept: valid.length }, "stage_2.photos_validated");
      photos = valid;
    }
  }

  let brandColor = lead.brand_color;
  if (!brandColor && photos.length) {
    const first = photos[0];
    let src = first.url ?? null;

    // Google Places photos: resolve resource name → redirect URL (extra cost)
    if (!src && first.name) {
      try {
        src = await getPhotoUrl(first.name);
      } catch (err) {
        log.warn({ err: String(err) }, "stage_2.photo_resolve_failed");
      }
    }

    if (src) brandColor = await extractBrandColor(src);
  }

  // Country lives on the batch row, not the lead — used both as a slug
  // context hint AND as the residential-proxy egress country for the
  // Playwright FB/IG fetch. Best-effort: lookup failure leaves it null
  // and downstream falls back to PROXY_DEFAULT_COUNTRY.
  let countryCode: string | null = null;
  try {
    const { data: batch } = await getDb()
      .from("batches")
      .select("country_code")
      .eq("id", lead.batch_id)
      .single();
    countryCode = batch?.country_code ?? null;
  } catch (err) {
    log.warn({ err: String(err).slice(0, 200) }, "stage_2.batch_lookup_failed");
  }

  // Social URL discovery — runs only when Google didn't surface one
  // (website_kind is "none" or null AND website_url is null). We slugify
  // the business name and try each candidate as a direct Facebook /
  // Instagram profile URL; the Playwright og:image fetcher validates
  // each guess and returns the real profile pic on a hit. Soft-fails to
  // null when no guess matches. Cached on lead.website_url + .website_kind
  // + .logo_url so subsequent rebuilds reuse the find.
  let websiteUrl = lead.website_url ?? null;
  let websiteKind: WebsiteKind | null = lead.website_kind ?? null;
  /** When the guess succeeded, the validation already fetched the og:image —
   *  reuse it directly instead of paying for a second Playwright nav inside
   *  resolveLogo. Stored as a base64 data URI (not the raw fbcdn URL). */
  let prefetchedLogoUrl: string | null = null;
  let logoBytes: Buffer | null = null;
  const noUsableUrl = !websiteUrl && (websiteKind === "none" || websiteKind === null);
  if (noUsableUrl) {
    try {
      const found = await findSocialUrl({
        business_name: lead.business_name,
        city: cityFromAddress(lead.address),
        country_code: countryCode,
      });
      if (found) {
        websiteUrl = found.url;
        websiteKind = found.kind;
        prefetchedLogoUrl = found.prefetched_logo_url ?? null;
        logoBytes = found.prefetched_logo_bytes ?? null;
        log.info(
          { lead_id: lead.id, url: found.url, kind: found.kind, prefetched: !!prefetchedLogoUrl },
          "stage_2.social_found",
        );
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_2.social_search_failed");
    }
  }

  // Logo enrichment: Brandfetch (real domain), Playwright og:image (FB/IG),
  // monogram fallback. Idempotent — overwrites lead.logo_url every time so
  // an upgraded Brandfetch index or new social discovery is reflected.
  // Shortcut: if findSocialUrl already fetched the og:image during validation,
  // use it directly and skip the duplicate Playwright nav.
  let logoUrl: string | null = lead.logo_url ?? null;
  if (prefetchedLogoUrl) {
    logoUrl = prefetchedLogoUrl;
  } else {
    try {
      const result = await resolveLogo({
        business_name: lead.business_name,
        website_url: websiteUrl,
        website_kind: websiteKind,
        brand_hex: brandColor ?? FALLBACK_HEX,
        category: lead.category ?? null,
        country_code: countryCode,
      });
      logoUrl = result.logo_url;
      logoBytes = result.logo_bytes ?? null;
    } catch (err) {
      log.warn({ err: String(err) }, "stage_2.logo_failed");
    }
  }

  // Derive brand_color from the LOGO itself when we have real image bytes.
  // The default `brandColor` above is extracted from the first Google Places
  // photo, which is usually a product shot whose dominant color has nothing
  // to do with the brand identity (e.g. The Little Things' photo array is
  // dominated by deep-orange balloon decor → #D3800F theme, while the
  // actual brand is gold/cream/pink florals on a script logo). Pulling the
  // palette from the logo gives the generated site a theme that actually
  // matches the brand.
  //
  // Skipped for monogram fallbacks (SVG data URIs) because the logo's
  // colour IS the brand_color we started with — extracting would just
  // round-trip the same value.
  if (logoBytes) {
    try {
      const logoColor = await extractBrandColor(logoBytes);
      if (logoColor && logoColor !== FALLBACK_HEX) {
        log.info(
          { lead_id: lead.id, prev: brandColor, next: logoColor },
          "stage_2.brand_color_from_logo",
        );
        brandColor = logoColor;
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_2.logo_color_extraction_failed");
    }
  }

  // Email enrichment — EMAIL channel (has-website leads only). Crawl the business's own site
  // (homepage + contact pages) for a contact address; free, no paid API. No-website leads have
  // a facebook/instagram/none website_kind and are skipped here — they go to the DM/SMS channel.
  let email = lead.email;
  if (!email && websiteKind === "real" && websiteUrl) {
    try {
      email = await findWebsiteEmail(websiteUrl, countryCode);
      if (email) log.info({ lead_id: lead.id, email }, "stage_2.email_found");
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_2.email_crawl_failed");
    }
  }

  // ── Real website images ────────────────────────────────────────────────
  // For leads with a real owned site (has_website / old_website → Improve),
  // also scrape the site's OWN content photos (hero / gallery) and MERGE them
  // with the Google Maps set, so an Improve demo shows THEIR real imagery, not
  // stock. Deduped by URL; each new URL is validated to actually serve an image
  // (same check the Google photos get). Free — plain fetch, no paid API.
  if (websiteKind === "real" && websiteUrl) {
    try {
      const siteImages = await extractWebsiteImages(websiteUrl);
      const have = new Set(photos.map((p) => p.url).filter(Boolean));
      const fresh = siteImages.filter((u) => !have.has(u));
      if (fresh.length) {
        const checks = await Promise.all(
          fresh.map(async (u) => ({ u, ok: await urlServesImage(u) })),
        );
        const valid = checks.filter((c) => c.ok).map((c) => ({ url: c.u, name: "website" }));
        if (valid.length) {
          photos = [...photos, ...valid];
          log.info(
            { lead_id: lead.id, added: valid.length, total: photos.length },
            "stage_2.website_images_merged",
          );
        }
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "stage_2.website_images_failed");
    }
  }

  // ── Offer routing (idempotent) ─────────────────────────────────────────
  // Backfill primary/secondary offer + audit for leads scraped before the
  // audit/offer split (migration 016), and refresh after social discovery.
  // Skipped entirely when the operator has locked the offer. Re-audit only
  // when we've never scored this site (keeps Build cheap + idempotent).
  const offerFields: Record<string, unknown> = {};
  if (!lead.offer_locked) {
    let hasWebsite =
      lead.has_website === true ||
      (websiteKind === "real" && !!websiteUrl);
    let needsImprovement = lead.needs_improvement ?? null;

    if (hasWebsite && websiteUrl && lead.website_score == null) {
      try {
        const audit = await auditWebsite(websiteUrl, {
          websiteKind,
          countryCode,
        });
        if (audit.parked) {
          // Parked / for-sale domain — not a real site. Treat as no_website so
          // the lead gets a Build offer (and its parking logo was already
          // rejected upstream). Flip website_kind so resolveSegment agrees.
          hasWebsite = false;
          websiteKind = "none";
          needsImprovement = false;
          offerFields.has_website = false;
          offerFields.website_status = "parked";
          offerFields.needs_improvement = false;
          offerFields.audited_at = new Date().toISOString();
          log.info({ lead_id: lead.id, url: websiteUrl }, "stage_2.parked_domain");
        } else {
          offerFields.website_score = audit.score;
          offerFields.website_issues = audit.issues;
          offerFields.needs_improvement = audit.needs_improvement;
          offerFields.website_status = audit.status;
          offerFields.audited_at = new Date().toISOString();
          needsImprovement = audit.needs_improvement;
        }
      } catch (err) {
        log.warn({ err: String(err).slice(0, 200) }, "stage_2.audit_failed");
      }
    }

    const route = routeOffer({ has_website: hasWebsite, needs_improvement: needsImprovement });
    offerFields.call_segment = route.segment;
    offerFields.primary_offer = route.primary_offer;
    offerFields.secondary_offer = route.secondary_offer;
  }

  // Stage-2 does NOT early-return for has_website — brand color/logo is always useful on re-enrichment.
  const { error } = await getDb()
    .from("leads")
    .update({
      brand_color: brandColor,
      email,
      logo_url: logoUrl,
      website_url: websiteUrl,
      website_kind: websiteKind,
      photos,
      stage: "enriched",
      ...offerFields,
    })
    .eq("id", lead.id);
  if (error) throw new Error(`stage_2.persist.error: ${error.message}`);

  log.info(
    {
      lead_id: lead.id,
      brand_color: brandColor,
      logo_source: logoUrl?.startsWith("data:")
        ? "monogram"
        : websiteKind === "facebook" || websiteKind === "instagram"
          ? websiteKind
          : "brandfetch",
      website_kind: websiteKind,
    },
    "stage_2.done",
  );
  return { brand_color: brandColor, email, logo_url: logoUrl };
}
