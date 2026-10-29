/**
 * build-brain.ts — orchestrate one Brand Brain build: crawl sources, extract facts, save a profile version.
 *
 * Inputs:  client id; its client_sources / source_pages / brand_assets; the lead's Maps data; operator intake
 * Outputs: a brand_profiles version (+ materialised products when current), a generation_jobs row, cleared brain_started_at
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
import { buildExtractionInput, type ExtractionInput, type MapsFacts } from "./extract/prompt";
import { FACT_PATHS } from "./extract/schema";
import { extractBrandFacts, extractVoice } from "@/lib/services/gemini-brand";
import { estimateCostUsd, type Usage } from "./cost";
import { assembleProfile, validateFacts } from "./facts";
import { getCurrentProfile, materializeProducts, saveProfileVersion } from "./profile";
import {
  EMPTY_PROFILE,
  type BrandProfileData,
  type ExtractedFact,
  type PageRef,
  type ProductSnapshot,
  type SourceKind,
} from "./types";

const log = getLogger("build-brain");

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
  const jobId = (job as { id: string }).id;

  try {
    // 1. crawl every web/social source (failures are recorded on the source, never fatal)
    let logoAssetId: string | null = null;
    let demoLogoId: string | null = null;
    let socialCrawled = false;
    for (const s of sources) {
      try {
        if (s.kind === "website" || s.kind === "demo_site") {
          const r = await crawlSite(s, { maxPages: env.BRAND_BRAIN_MAX_PAGES, client });
          if (r.brand.logo_asset_id) {
            if (s.kind === "website") logoAssetId ??= r.brand.logo_asset_id;
            else demoLogoId ??= r.brand.logo_asset_id;
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
      .order("created_at", { ascending: true })
      .limit(60);
    const assets = (assetRows ?? []) as { id: string; alt: string | null; source_url: string | null }[];
    const assetIds = new Set(assets.map((a) => a.id));

    let maps: MapsFacts | null = null;
    if (sources.some((s) => s.kind === "google_maps") && client.lead_id) {
      const { data: lead } = await db
        .from("leads")
        .select("business_name,category,address,phone,rating,review_count,business_hours,reviews")
        .eq("id", client.lead_id)
        .maybeSingle();
      if (lead) maps = mapsFactsFromLead(lead as LeadFacts);
    }
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

    // 3. facts
    let usage: Usage | null = null;
    const facts = await extract(input);
    usage = addUsage(usage, facts.usage);

    const reasons: Record<string, number> = {};
    const bump = (r: string) => (reasons[r] = (reasons[r] ?? 0) + 1);
    const known = new Set(FACT_PATHS);
    const pathOk: ExtractedFact[] = [];
    for (const f of facts.output.facts) {
      if (known.has(f.path)) pathOk.push(f);
      else bump("unknown_path");
    }
    const { kept, dropped } = validateFacts(pathOk, pageRefs);
    for (const d of dropped) bump(d.reason);

    const data: BrandProfileData = assembleProfile(kept, pageRefs);

    // 4. voice (only when there is something to read)
    let voiceCalled = false;
    if (input.pages.length || intake) {
      voiceCalled = true;
      const v = await voice({
        passages: input.pages.slice(0, 6).map((p) => p.text.slice(0, 1500)),
        intake,
        category: maps?.category ?? data.business.category?.value ?? null,
      });
      usage = addUsage(usage, v.usage);
      const firstPage = input.pages[0];
      const vKind: SourceKind = firstPage ? (kindByPage.get(firstPage.id) ?? "website") : "operator";
      const mk = (value: string) => ({
        value,
        source: { kind: vKind, url: firstPage?.url ?? null, page_id: firstPage?.id ?? null, quote: null },
        confirmed: false,
      });
      data.voice = {
        tone: v.output.tone.map(mk),
        style_notes: v.output.style_notes ? mk(v.output.style_notes) : null,
        do: v.output.do.map(mk),
        dont: v.output.dont.map(mk),
        sample_lines: v.output.sample_lines.map(mk),
      };
    } else {
      data.voice = structuredClone(EMPTY_PROFILE.voice);
    }

    // page-sourced facts carry their real source kind (demo_site / facebook / instagram)
    retagPageFacts(data, kindByPage);

    // 5. products + logo
    const products: ProductSnapshot[] = [];
    for (const p of facts.output.products) {
      const check = validateFacts([{ path: "products", value: p.name, source: p.source, quote: p.quote }], pageRefs);
      if (check.dropped.length) {
        bump(`product_${check.dropped[0].reason}`);
        continue;
      }
      const page = pageRefs.find((r) => r.id === p.source);
      const source =
        p.source === "operator"
          ? { kind: "operator" as const }
          : p.source === "google_maps"
            ? { kind: "google_maps" as const }
            : {
                kind: kindByPage.get(p.source) ?? ("website" as SourceKind),
                url: page?.url ?? null,
                page_id: p.source,
                quote: p.quote,
              };
      const index = products.length;
      products.push({
        name: p.name,
        description: p.description,
        price: p.price,
        category: p.category,
        featured: index < 10,
        sort: index,
        image_asset_ids: p.image_asset_ids.filter((id) => assetIds.has(id)),
        source,
        confirmed: false,
      });
    }
    data.products = products;
    data.visuals.logo_asset_id = logoAssetId;

    // 6. save
    const current = await getCurrentProfile(clientId);
    const state = current ? ("pending_review" as const) : ("current" as const);
    const { version } = await saveProfileVersion(clientId, data, { writtenBy: "ai", state, jobId });
    if (state === "current") await materializeProducts(clientId, data.products);

    // 7. finish the job row
    const factsDropped = Object.values(reasons).reduce((a, b) => a + b, 0);
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
          facts_kept: kept.length,
          facts_dropped: factsDropped,
          dropped_reasons: reasons,
          pages: input.pages.length,
          products: products.length,
          voice_called: voiceCalled,
        },
      })
      .eq("id", jobId);
    const result = { version, state, facts_kept: kept.length, facts_dropped: factsDropped, cost_usd: costUsd };
    log.info({ clientId, jobId, ...result }, "build_brain.done");
    return result;
  } catch (err) {
    await db
      .from("generation_jobs")
      .update({ status: "failed", error: String(err).slice(0, 500), finished_at: new Date().toISOString() })
      .eq("id", jobId);
    throw err;
  } finally {
    await db.from("clients").update({ brain_started_at: null }).eq("id", clientId);
  }
}
