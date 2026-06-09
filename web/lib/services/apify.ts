/**
 * apify.ts — Apify Google Maps scraper (with website-crawled emails + social links).
 *
 * Inputs:  query (e.g. 'gym in Yogyakarta'), limit, language
 * Outputs: NormalizedLead[]  — same shape as google-places.ts / outscraper.ts, PLUS email + socials
 * Used by: lib/pipeline/stage-1-scrape.ts when batch.scraper == 'apify' (the default)
 *
 * Unlike Places/Outscraper, Apify visits each business's website and returns a contact email +
 * Facebook/Instagram/etc. in the same pass — feeding both the email channel (has-website leads)
 * and the DM channel (social page). ~$1.5–2.1 per 1,000 places; no per-query cap.
 *
 * Runs the actor ASYNC (start → poll → read dataset) because crawling sites takes minutes — fine
 * from the CLI/Cloud Run batch runner (not the 60s serverless path). Actor:
 * lukaskrivka/google-maps-with-contact-details. Docs: https://apify.com/lukaskrivka/google-maps-with-contact-details
 */

import { env } from "../config";
import { classifyWebsite, hasRealWebsite } from "../filters";
import { getLogger } from "../logger";
import { retry } from "../retry";
import type { BusinessStatus, NormalizedLead } from "./types";

const log = getLogger("apify");
const BASE_URL = "https://api.apify.com/v2";
const ACTOR = "lukaskrivka~google-maps-with-contact-details";
/** Safety cap — Apify has no hard per-query limit, but bound it so a typo can't run up cost. */
export const MAX_PER_QUERY = 300;
const POLL_INTERVAL_MS = 5000;
const RUN_DEADLINE_MS = 8 * 60 * 1000; // crawling + contact extraction can take a few minutes

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Trim a possibly-blank Apify string; "" / whitespace → null. Apify frequently
 *  returns "" for a missing field, which `?? null` would let through as a value. */
const clean = (s?: string | null): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

interface ApifyPlace {
  title?: string;
  phone?: string;
  phoneUnformatted?: string;
  address?: string;
  categoryName?: string;
  category?: string;
  categories?: string[];
  totalScore?: number;
  reviewsCount?: number;
  website?: string;
  emails?: string[];
  facebooks?: string[];
  instagrams?: string[];
  placeId?: string;
  location?: { lat?: number; lng?: number };
  imageUrls?: string[];
  imageUrl?: string;
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  reviews?: Array<{ text?: string; stars?: number; name?: string }>;
}

export async function searchGoogleMaps(opts: {
  query: string;
  limit?: number;
  language?: string;
  region?: string;
}): Promise<NormalizedLead[]> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN missing");
  const cap = Math.min(opts.limit ?? 100, MAX_PER_QUERY);

  // 1. Start the run (only fields confirmed against the actor's schema).
  log.info({ query: opts.query, limit: cap }, "apify.run.start");
  const startResp = await retry(
    () =>
      fetch(`${BASE_URL}/acts/${ACTOR}/runs?token=${env.APIFY_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchStringsArray: [opts.query],
          maxCrawledPlacesPerSearch: cap,
          language: opts.language ?? "en",
        }),
      }),
    { maxAttempts: 3 },
  );
  if (!startResp.ok) throw new Error(`apify.run.error ${startResp.status}: ${await startResp.text()}`);
  const run = ((await startResp.json()) as { data?: { id?: string; defaultDatasetId?: string; status?: string } }).data;
  const runId = run?.id;
  const datasetId = run?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error("apify.run.error: missing run id / dataset id");

  // 2. Poll until the run finishes (or the deadline). Items stream into the dataset as it runs,
  //    so even a timeout yields partial results in step 3.
  const deadline = Date.now() + RUN_DEADLINE_MS;
  let status = run?.status ?? "RUNNING";
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (Date.now() > deadline) {
      log.warn({ runId, status }, "apify.run.deadline — reading partial dataset");
      break;
    }
    await sleep(POLL_INTERVAL_MS);
    try {
      const s = await fetch(`${BASE_URL}/actor-runs/${runId}?token=${env.APIFY_TOKEN}`);
      if (s.ok) status = ((await s.json()) as { data?: { status?: string } }).data?.status ?? status;
    } catch {
      /* transient — keep polling */
    }
  }
  if (status === "FAILED" || status === "ABORTED") {
    throw new Error(`apify.run.${status.toLowerCase()} (run ${runId})`);
  }

  // 3. Read the dataset.
  const itemsResp = await retry(
    () => fetch(`${BASE_URL}/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}&clean=true&limit=${cap}`),
    { maxAttempts: 3 },
  );
  if (!itemsResp.ok) throw new Error(`apify.dataset.error ${itemsResp.status}: ${await itemsResp.text()}`);
  const items = (await itemsResp.json()) as ApifyPlace[];
  const leads = items.map(normalize);
  log.info({ count: leads.length, runId, status }, "apify.run.done");
  return leads;
}

function normalize(item: ApifyPlace): NormalizedLead {
  // Email: lowercase + de-dupe; take the first clean one.
  const emails = (item.emails ?? [])
    .map((e) => String(e).toLowerCase().trim())
    .filter((e) => e.includes("@"));
  const email = emails[0] ?? null;

  // Website: prefer a real site; fall back to a social page so no-website leads still get a
  // findable page (the DM channel). has_website reflects ONLY a real website (drives build vs improve).
  const realSite = clean(item.website);
  const social = clean(item.facebooks?.[0]) ?? clean(item.instagrams?.[0]);
  const site = realSite ?? social;

  return {
    business_name: clean(item.title) ?? "",
    // Apify returns the display number in `phone`, but sometimes only the E.164
    // value in `phoneUnformatted` (esp. international / multi-location), and it
    // frequently returns "" for a missing field — so coalesce both and treat ""
    // as null. (Reading only `phone` was silently dropping ~2% of numbers.)
    phone: clean(item.phone) ?? clean(item.phoneUnformatted),
    address: clean(item.address),
    category: clean(item.categoryName) ?? clean(item.category) ?? clean(item.categories?.[0]),
    rating: item.totalScore ?? null,
    review_count: item.reviewsCount ?? null,
    has_website: hasRealWebsite(realSite),
    website: site,
    website_kind: classifyWebsite(site),
    email,
    business_status: item.permanentlyClosed
      ? "CLOSED_PERMANENTLY"
      : item.temporarilyClosed
        ? "CLOSED_TEMPORARILY"
        : ("OPERATIONAL" as BusinessStatus),
    is_service_area_only: !clean(item.address),
    photos: (item.imageUrls ?? (item.imageUrl ? [item.imageUrl] : [])).slice(0, 5).map((url) => ({ url })),
    reviews: (item.reviews ?? []).map((r) => ({ text: r.text, rating: r.stars, author: r.name })),
    place_id: item.placeId ?? null,
    latitude: item.location?.lat ?? null,
    longitude: item.location?.lng ?? null,
    raw: item,
  };
}
