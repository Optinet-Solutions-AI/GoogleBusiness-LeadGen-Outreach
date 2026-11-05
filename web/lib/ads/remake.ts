/**
 * ads/remake.ts — "Make our version": analyse a competitor ad for one client and create a Creative Studio post from it.
 *
 * Inputs:  ad id, client id, platforms
 * Outputs: { creative_id, analysis } — a draft creative (free until Generated) + the analysis saved on the ad;
 *          a generation_jobs row (kind 'ad_remake', Gemini cost)
 * Used by: app/api/ads/[id]/remake/route.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { env } from "@/lib/config";
import { estimateCostUsd } from "@/lib/clients/cost";
import type { BrandProfileData } from "@/lib/clients/types";
import { getCurrentProfile, snapshotProducts } from "@/lib/clients/profile";
import { createSingleCreative } from "@/lib/creatives/creatives";
import type { Platform } from "@/lib/creatives/types";
import { analyzeCompetitorAd, type AdAnalysis } from "@/lib/services/gemini-ads";
import { getAd, recordRemake } from "./library";

const log = getLogger("ad-remake");

export class RemakeError extends Error {}

async function currentProfile(clientId: string): Promise<BrandProfileData> {
  const cur = await getCurrentProfile(clientId);
  if (!cur) throw new RemakeError("Build and accept this client's Brand Brain first");
  return cur.data;
}

/** The brief the copywriter (Gemini copy step) gets: the analysis in plain words. Pure. */
export function briefFromAnalysis(a: AdAnalysis, competitor: string | null): string {
  const beats = a.structure.map((s, i) => `${i + 1}. ${s}`).join(" ");
  return [
    a.our_brief.trim(),
    `Hook style: ${a.hook}. Angle: ${a.angle}. Tone: ${a.tone}. Offer shape: ${a.offer_shape}.`,
    `Structure to follow: ${beats}`,
    `Inspired by an ad from ${competitor ?? "a competitor"} — do not reuse any of their wording, numbers or claims.`,
  ].join("\n");
}

export async function remakeAd(input: { adId: string; clientId: string; platforms: Platform[] }): Promise<{ creative_id: string; analysis: AdAnalysis; cost_usd: number }> {
  const ad = await getAd(input.adId);
  const [profile, products] = await Promise.all([currentProfile(input.clientId), snapshotProducts(input.clientId)]);
  const started = Date.now();
  const db = getDb();
  const { data: job } = await db
    .from("generation_jobs")
    .insert({ client_id: input.clientId, kind: "ad_remake", provider: "gemini", model: env.GOOGLE_GENAI_MODEL, status: "running", input: { ad_id: ad.id, page: ad.page_name } })
    .select("id")
    .single();
  const jobId = (job as { id: string } | null)?.id ?? null;
  try {
    const { output: analysis, usage } = await analyzeCompetitorAd({ ad, profile, products, platforms: input.platforms });
    const cost = estimateCostUsd(usage);
    const creative = await createSingleCreative(input.clientId, {
      title: analysis.our_title.slice(0, 120),
      brief: briefFromAnalysis(analysis, ad.page_name),
      template_key: analysis.template_key,
      kind: "image",
      platforms: input.platforms,
      slot_date: new Date().toISOString().slice(0, 10),
    });
    await recordRemake(ad.id, analysis, { client_id: input.clientId, creative_id: creative.id, at: new Date().toISOString() });
    if (jobId) {
      await db
        .from("generation_jobs")
        .update({ status: "done", prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cost_usd: cost, output: { creative_id: creative.id }, finished_at: new Date().toISOString() })
        .eq("id", jobId);
    }
    log.info({ ad_id: ad.id, client_id: input.clientId, creative_id: creative.id, cost_usd: cost, ms: Date.now() - started }, "ad_remake.done");
    return { creative_id: creative.id, analysis, cost_usd: cost };
  } catch (err) {
    if (jobId) await db.from("generation_jobs").update({ status: "failed", error: String(err).slice(0, 500), finished_at: new Date().toISOString() }).eq("id", jobId);
    throw err;
  }
}
