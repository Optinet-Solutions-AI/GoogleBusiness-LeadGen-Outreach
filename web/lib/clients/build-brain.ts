/**
 * build-brain.ts — orchestrate one Brand Brain build: crawl sources, extract facts, save a profile version.
 *
 * Inputs:  client id; its client_sources / source_pages / brand_assets; the lead's Maps data, colour, logo and
 *          photos; operator intake
 * Outputs: a brand_profiles version (+ materialised products / photo links when current), copied lead assets,
 *          a generation_jobs row, cleared brain_started_at; pure assembly helpers (assembleBuildResult, sourceRefs)
 * Used by: scripts/cloud-run-job.ts (MODE=brand-brain), POST /api/clients/[id]/brain/build (local fallback)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { getClient } from "./clients";
import { listSources, type SourceRow } from "./sources";
import { crawlSite } from "./crawl/crawl-site";
import { crawlSocial } from "./crawl/crawl-social";
import {
  buildExtractionInput,
  renderIntake,
  renderMaps,
  type ExtractionInput,
  type MapsFacts,
} from "./extract/prompt";
import { FACT_PATHS, type ExtractionOutput, type VoiceOutput } from "./extract/schema";
import { extractBrandFacts, extractVoice } from "@/lib/services/gemini-brand";
import { estimateCostUsd, type Usage } from "./cost";
import { copyRemoteImage } from "./assets";
import { assembleProfile, isPseudoSource, normalizeForMatch, validateFacts } from "./facts";
import { getCurrentProfile, materializeProducts, saveProfileVersion } from "./profile";
import {
  EMPTY_PROFILE,
  type BrandProfileData,
  type ExtractedFact,
  type FactSource,
  type PageRef,
  type ProductSnapshot,
  type SourceKind,
} from "./types";

const log = getLogger("build-brain");

/** Passages handed to the voice call (and the pages whose source kind the voice is tagged with). */
const VOICE_PASSAGES = 6;
const LEAD_PHOTO_MAX = 30;
/** Stop copying the lead's Maps photos once this much time has gone into asset copying in this build. */
const ASSET_COPY_BUDGET_MS = 30_000;

export type LeadFacts = {
  business_name: string | null;
  category: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number | null;
  business_hours: Record<string, string> | null;
  reviews: { text?: string | null; rating?: number | null; author?: string | null }[] | null;
};

type LeadRow = LeadFacts & { brand_color: string | null; logo_url: string | null; photos: unknown };

const LEAD_COLUMNS =
  "business_name,category,address,phone,rating,review_count,business_hours,reviews,brand_color,logo_url,photos";

const isHex = (s: unknown): s is string =>
  typeof s === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
const isHttpUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\//i.test(s.trim());

export function assertBuildable(sources: SourceRow[]): void {
  if (sources.length === 0) {
    throw new Error("Attach at least one source (website, social, Google Maps or the intake form) before building.");
  }
}

export function mapsFactsFromLead(lead: LeadFacts): MapsFacts {
  const hours = lead.business_hours && Object.keys(lead.business_hours).length ? lead.business_hours : null;
  return {
    name: lead.business_name,
    category: lead.category,
    address: lead.address,
    phone: lead.phone,
    rating: lead.rating,
    review_count: lead.review_count,
    hours,
    reviews: (lead.reviews ?? [])
      .filter((r) => typeof r?.text === "string" && r.text.trim() !== "")
      .map((r) => ({ author: r.author ?? null, rating: r.rating ?? null, text: r.text as string })),
  };
}

/** `leads.photos` holds URLs or Google photo names; only http(s) URLs can be copied. Deduped, capped. */
export function leadPhotoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const p of photos) {
    const url = typeof p === "string" ? p : (p as { url?: unknown } | null)?.url;
    if (isHttpUrl(url) && !out.includes(url.trim())) out.push(url.trim());
    if (out.length >= LEAD_PHOTO_MAX) break;
  }
  return out;
}

/**
 * Everything a fact may cite: the crawled pages plus the `operator` / `google_maps` pseudo-pages, added only
 * when that input exists — their text is exactly the INTAKE / MAPS section the model was shown.
 */
export function sourceRefs(pages: PageRef[], intakeText: string | null, mapsText: string | null): PageRef[] {
  const refs = [...pages];
  if (intakeText?.trim()) refs.push({ id: "operator", url: null, text: intakeText });
  if (mapsText?.trim()) refs.push({ id: "google_maps", url: null, text: mapsText });
  return refs;
}

/** Spec §5.2: no crawled text and no intake form → skip the voice call. */
export function needsVoiceCall(input: ExtractionInput): boolean {
  return input.pages.length > 0 || !!input.intake;
}

/** Walk the assembled profile and retag every page-sourced fact with its page's source kind. */
function retagPageFacts(node: unknown, kindByPage: Map<string, SourceKind>): void {
  if (Array.isArray(node)) {
    for (const n of node) retagPageFacts(n, kindByPage);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const o = node as Record<string, unknown>;
  const src = o.source as { kind?: SourceKind; page_id?: string | null } | undefined;
  if (src && typeof src === "object" && src.page_id && kindByPage.has(src.page_id)) {
    src.kind = kindByPage.get(src.page_id);
  }
  for (const v of Object.values(o)) retagPageFacts(v, kindByPage);
}

/** The source kind most of these pages come from (first seen wins a tie). */
function dominantKind(pages: PageRef[], kindByPage: Map<string, SourceKind>): SourceKind {
  const counts = new Map<SourceKind, number>();
  for (const p of pages) {
    const k = kindByPage.get(p.id) ?? "website";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: SourceKind = "website";
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

const aiFact = (value: string, source: FactSource) => ({ value, source, confirmed: false });

export type CrawlColor = { hex: string; kind: SourceKind; url: string | null };

export type BuildAssemblyInput = {
  extraction: ExtractionOutput;
  /** null when the voice call was skipped (no crawled text and no intake). */
  voice: VoiceOutput | null;
  /** The crawled pages the model saw (the `operator` / `google_maps` pseudo-pages are added from the texts below). */
  pages: PageRef[];
  kindByPage: Map<string, SourceKind>;
  assetIds: Set<string>;
  /** Rendered OPERATOR INTAKE section, null when there is no intake. */
  intakeText: string | null;
  /** Rendered GOOGLE MAPS section, null when there is no google_maps source / lead. */
  mapsText: string | null;
  /** Brand colour found while crawling the website (else the demo site). */
  crawlColor: CrawlColor | null;
  /** The lead's `brand_color` (only passed when the client has a google_maps source). */
  leadColor: string | null;
};

export type BuildAssembly = {
  data: BrandProfileData;
  factsKept: number;
  /** Drop counts by reason (facts and products). */
  reasons: Record<string, number>;
  /** Products kept whose price was not in their quote (price set to null). */
  pricesNulled: number;
};

/** Pure: validate the extraction against its sources and assemble the profile the build will save. */
export function assembleBuildResult(input: BuildAssemblyInput): BuildAssembly {
  const reasons: Record<string, number> = {};
  const bump = (r: string) => (reasons[r] = (reasons[r] ?? 0) + 1);
  const refs = sourceRefs(input.pages, input.intakeText, input.mapsText);
  const byId = new Map(refs.map((r) => [r.id, r]));

  // 1. facts: known paths, quote (or short value) found in the cited text
  const known = new Set(FACT_PATHS);
  const pathOk: ExtractedFact[] = [];
  for (const f of input.extraction.facts) {
    if (known.has(f.path)) pathOk.push(f);
    else bump("unknown_path");
  }
  const { kept, dropped } = validateFacts(pathOk, refs);
  for (const d of dropped) bump(d.reason);
  const data = assembleProfile(kept, refs);

  // 2. voice: an AI summary, never a quote — tagged with the dominant source, no page/url
  if (input.voice) {
    const v = input.voice;
    const kind: SourceKind = input.pages.length
      ? dominantKind(input.pages.slice(0, VOICE_PASSAGES), input.kindByPage)
      : "operator";
    const mk = (value: string) => aiFact(value, { kind, url: null, page_id: null, quote: null });
    data.voice = {
      tone: v.tone.map(mk),
      style_notes: v.style_notes ? mk(v.style_notes) : null,
      do: v.do.map(mk),
      dont: v.dont.map(mk),
      sample_lines: v.sample_lines.map(mk),
    };
  } else {
    data.voice = structuredClone(EMPTY_PROFILE.voice);
  }

  // page-sourced facts carry their real source kind (demo_site / facebook / instagram)
  retagPageFacts(data, input.kindByPage);

  // 3. products: validated like facts; a price survives only when it is inside the product's quote
  const products: ProductSnapshot[] = [];
  let pricesNulled = 0;
  for (const p of input.extraction.products) {
    const check = validateFacts([{ path: "products", value: p.name, source: p.source, quote: p.quote }], refs);
    if (check.dropped.length) {
      bump(`product_${check.dropped[0].reason}`);
      continue;
    }
    const ref = byId.get(p.source) as PageRef;
    const pseudo = isPseudoSource(p.source);
    const priceQuoted =
      !!p.price && !!p.quote && normalizeForMatch(p.quote).includes(normalizeForMatch(p.price));
    if (p.price && !priceQuoted) pricesNulled++;
    const index = products.length;
    products.push({
      name: p.name,
      description: p.description,
      price: priceQuoted ? p.price : null,
      category: p.category,
      featured: index < 10,
      sort: index,
      image_asset_ids: p.image_asset_ids.filter((id) => input.assetIds.has(id)),
      source: {
        kind: pseudo ? (p.source as SourceKind) : (input.kindByPage.get(p.source) ?? "website"),
        url: ref.url,
        page_id: pseudo ? null : p.source,
        quote: p.quote,
      },
      confirmed: false,
    });
  }
  data.products = products;

  // 4. primary colour: crawl colour > whatever the text said > the lead's colour
  if (input.crawlColor && isHex(input.crawlColor.hex)) {
    data.visuals.colors.primary = aiFact(input.crawlColor.hex.trim(), {
      kind: input.crawlColor.kind,
      url: input.crawlColor.url,
      page_id: null,
      quote: null,
    });
  } else if (!data.visuals.colors.primary && isHex(input.leadColor)) {
    data.visuals.colors.primary = aiFact(input.leadColor.trim(), {
      kind: "google_maps",
      url: null,
      page_id: null,
      quote: null,
    });
  }

  return { data, factsKept: kept.length, reasons, pricesNulled };
}

const addUsage = (a: Usage | null, b: Usage): Usage =>
  a
    ? {
        prompt_tokens: a.prompt_tokens + b.prompt_tokens,
        completion_tokens: a.completion_tokens + b.completion_tokens,
        model: b.model,
      }
    : b;

type Deps = { extract?: typeof extractBrandFacts; voice?: typeof extractVoice };

export async function runBrandBrainBuild(
  clientId: string,
  deps: Deps = {},
): Promise<{
  version: number;
  state: "current" | "pending_review";
  facts_kept: number;
  facts_dropped: number;
  cost_usd: number;
}> {
  const extract = deps.extract ?? extractBrandFacts;
  const voice = deps.voice ?? extractVoice;
  const db = getDb();
  let jobId: string | null = null;
  try {
    const client = await getClient(clientId);
    if (!client) throw new Error("client not found");
    const sources = await listSources(clientId);
    assertBuildable(sources);

    const { data: job, error: jobErr } = await db
      .from("generation_jobs")
      .insert({
        client_id: clientId,
        kind: "brand_brain",
        provider: "gemini",
        model: env.GOOGLE_GENAI_MODEL,
        status: "running",
        input: { sources: sources.map((s) => ({ kind: s.kind, url: s.url })) },
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`job insert failed: ${jobErr?.message}`);
    jobId = (job as { id: string }).id;

    // 1. crawl every web/social source (failures are recorded on the source, never fatal)
    let logoAssetId: string | null = null;
    let demoLogoId: string | null = null;
    let siteColor: CrawlColor | null = null;
    let demoColor: CrawlColor | null = null;
    let socialCrawled = false;
    let assetMs = 0;
    for (const s of sources) {
      try {
        if (s.kind === "website" || s.kind === "demo_site") {
          const r = await crawlSite(s, { maxPages: env.BRAND_BRAIN_MAX_PAGES, client });
          assetMs += r.asset_ms;
          if (r.brand.logo_asset_id) {
            if (s.kind === "website") logoAssetId ??= r.brand.logo_asset_id;
            else demoLogoId ??= r.brand.logo_asset_id;
          }
          if (isHex(r.brand.brand_color)) {
            const c: CrawlColor = { hex: r.brand.brand_color, kind: s.kind, url: s.url ?? client.website_url ?? null };
            if (s.kind === "website") siteColor ??= c;
            else demoColor ??= c;
          }
        } else if (s.kind === "facebook" || s.kind === "instagram") {
          await crawlSocial(s, client);
          socialCrawled = true;
        }
      } catch (err) {
        log.warn({ clientId, sourceId: s.id, err: String(err).slice(0, 300) }, "build_brain.crawl_failed");
      }
    }
    if (!logoAssetId && socialCrawled) {
      const { data: logo } = await db
        .from("brand_assets")
        .select("id")
        .eq("client_id", clientId)
        .eq("kind", "logo")
        .in("origin", ["facebook", "instagram"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      logoAssetId = (logo as { id: string } | null)?.id ?? null;
    }
    logoAssetId ??= demoLogoId;

    // 1b. the lead row (google_maps source): Maps facts, colour, logo and photos
    let lead: LeadRow | null = null;
    if (sources.some((s) => s.kind === "google_maps") && client.lead_id) {
      const { data: leadRow } = await db.from("leads").select(LEAD_COLUMNS).eq("id", client.lead_id).maybeSingle();
      lead = (leadRow as LeadRow | null) ?? null;
    }
    let leadPhotosCopied = 0;
    if (lead) {
      const started = Date.now();
      // logo_url may be a monogram data: URI — only a real http(s) logo is copied
      if (isHttpUrl(lead.logo_url)) {
        const a = await copyRemoteImage({ clientId, url: lead.logo_url.trim(), origin: "lead", kind: "logo" }).catch(
          () => null,
        );
        logoAssetId ??= a?.id ?? null;
      }
      for (const url of leadPhotoUrls(lead.photos)) {
        if (assetMs + (Date.now() - started) > ASSET_COPY_BUDGET_MS) {
          log.info({ clientId, copied: leadPhotosCopied }, "build_brain.lead_photos_time_capped");
          break;
        }
        const a = await copyRemoteImage({ clientId, url, origin: "google_maps", kind: "photo" }).catch(() => null);
        if (a) leadPhotosCopied++;
      }
    }

    // 2. gather everything the model sees
    const kindBySource = new Map(sources.map((s) => [s.id, s.kind]));
    const { data: pageRows, error: pErr } = await db
      .from("source_pages")
      .select("id,source_id,url,title,text")
      .eq("client_id", clientId);
    if (pErr) throw new Error(`pages read failed: ${pErr.message}`);
    const rows = (pageRows ?? []) as {
      id: string;
      source_id: string;
      url: string;
      title: string | null;
      text: string | null;
    }[];
    const kindByPage = new Map<string, SourceKind>();
    for (const r of rows) kindByPage.set(r.id, kindBySource.get(r.source_id) ?? "website");

    const { data: assetRows } = await db
      .from("brand_assets")
      .select("id,alt,source_url")
      .eq("client_id", clientId)
      .eq("status", "ready")
      .neq("origin", "render")
      .order("created_at", { ascending: true })
      .limit(60);
    const assets = (assetRows ?? []) as { id: string; alt: string | null; source_url: string | null }[];
    const assetIds = new Set(assets.map((a) => a.id));

    const maps: MapsFacts | null = lead ? mapsFactsFromLead(lead) : null;
    const intake = sources.find((s) => s.kind === "operator")?.intake ?? null;

    const raw: ExtractionInput = {
      intake,
      maps,
      pages: rows
        .filter((r) => r.text)
        .map((r) => ({ id: r.id, url: r.url, title: r.title, text: r.text as string })),
      assets,
      language: null,
    };
    const input = buildExtractionInput(raw, env.BRAND_BRAIN_TEXT_BUDGET);
    if (!input.pages.length && !intake && !maps) {
      throw new Error("Nothing to extract: no source produced any text. Check each source's crawl status.");
    }
    const pageRefs: PageRef[] = input.pages.map((p) => ({ id: p.id, url: p.url, text: p.text }));
    // the exact section text the model is shown — operator / google_maps quotes are checked against it
    const intakeText = intake ? renderIntake(intake) || null : null;
    const mapsText = maps ? renderMaps(maps) || null : null;

    // 3. facts
    let usage: Usage | null = null;
    const facts = await extract(input);
    usage = addUsage(usage, facts.usage);

    // 4. voice (only when there is something to read)
    let voiceOut: VoiceOutput | null = null;
    if (needsVoiceCall(input)) {
      const category = validateFacts(
        facts.output.facts.filter((f) => f.path === "business.category"),
        sourceRefs(pageRefs, intakeText, mapsText),
      ).kept[0]?.value;
      const v = await voice({
        passages: input.pages.slice(0, VOICE_PASSAGES).map((p) => p.text.slice(0, 1500)),
        intake,
        category: maps?.category ?? (typeof category === "string" ? category : null),
      });
      usage = addUsage(usage, v.usage);
      voiceOut = v.output;
    }

    // 5. validate + assemble (pure), then the logo
    const built = assembleBuildResult({
      extraction: facts.output,
      voice: voiceOut,
      pages: pageRefs,
      kindByPage,
      assetIds,
      intakeText,
      mapsText,
      crawlColor: siteColor ?? demoColor,
      leadColor: lead?.brand_color ?? null,
    });
    const data: BrandProfileData = built.data;
    data.visuals.logo_asset_id = logoAssetId;

    // 6. save
    const current = await getCurrentProfile(clientId);
    const state = current ? ("pending_review" as const) : ("current" as const);
    const { version } = await saveProfileVersion(clientId, data, { writtenBy: "ai", state, jobId });
    if (state === "current") await materializeProducts(clientId, data.products);

    // 7. finish the job row
    const factsDropped = Object.values(built.reasons).reduce((a, b) => a + b, 0);
    const costUsd = usage ? estimateCostUsd(usage) : 0;
    await db
      .from("generation_jobs")
      .update({
        status: "done",
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        cost_usd: costUsd,
        finished_at: new Date().toISOString(),
        output: {
          facts_kept: built.factsKept,
          facts_dropped: factsDropped,
          dropped_reasons: built.reasons,
          prices_nulled: built.pricesNulled,
          pages: input.pages.length,
          products: data.products.length,
          voice_called: voiceOut !== null,
          lead_photos_copied: leadPhotosCopied,
        },
      })
      .eq("id", jobId);
    const result = { version, state, facts_kept: built.factsKept, facts_dropped: factsDropped, cost_usd: costUsd };
    log.info({ clientId, jobId, ...result }, "build_brain.done");
    return result;
  } catch (err) {
    if (jobId) {
      await db
        .from("generation_jobs")
        .update({ status: "failed", error: String(err).slice(0, 500), finished_at: new Date().toISOString() })
        .eq("id", jobId);
    }
    throw err;
  } finally {
    await db.from("clients").update({ brain_started_at: null }).eq("id", clientId);
  }
}
