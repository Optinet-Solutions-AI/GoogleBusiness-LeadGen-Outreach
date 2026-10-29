/**
 * generate.ts — Creative Studio generation: one creative (copy → background → render) and a month plan
 *               (concepts, then every concept still missing a ready creative, under the budget cap).
 *
 * Inputs:  creative id + action (all|copy|background|render) / plan id + action (concepts|generate); the
 *          client's current Brand Brain, products and assets
 * Outputs: creative_versions (inputs, copy, grounding, renders, ai), creatives.status/last_error, background +
 *          render brand_assets rows, content_plans concepts/status/pending_count/last_error, generation_jobs rows
 *          (content_plan_concepts, creative_copy, creative_image, creative_render)
 * Used by: scripts/cloud-run-job.ts (MODE=creative, MODE=content-plan); creative API routes (local fallback)
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { listAssets, newRenderRevision, pruneVersionRenders, storeRenderPng, type AssetRow } from "@/lib/clients/assets";
import { getClient } from "@/lib/clients/clients";
import { estimateCostUsd, imageCostUsd } from "@/lib/clients/cost";
import { getCurrentProfile, NotFoundError, snapshotProducts } from "@/lib/clients/profile";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import { proposeConcepts, writeCopy } from "@/lib/services/gemini-creative";
import {
  backgroundPrompt,
  generateBackground,
  isOpenAiConfigured,
  NEGATIVE_LIST,
} from "@/lib/services/openai-images";
import { runCapUsd } from "./cost";
import {
  claimCreativeRendering,
  createCreativeFromConcept,
  getCreative,
  newVersion,
  setCreativeStatus,
  setVersionAi,
  setVersionCopy,
  setVersionGrounding,
  setVersionInputs,
  setVersionRenders,
  type CreativeRow,
  type VersionRow,
} from "./creatives";
import { checkGrounding } from "./grounding";
import {
  claimGenerating,
  getPlan,
  planSpend,
  PlanStateError,
  setPlanStatus,
  touchHeartbeat,
  updatePlanConcepts,
  type PlanRow,
} from "./plans";
import { fontsFromProfile, RenderInputError, renderVersion } from "./render";
import {
  capToMaxPerPlan,
  completeInputs,
  conceptForCreative,
  conceptsToGenerate,
  creativeForConcept,
  creativeUnitFor,
  imageNeeded,
  nextBudgetCheck,
  pendingCount,
  reviewSource,
  seedVisuals,
  type VisualSeed,
} from "./select";
import { assignProducts, spreadSlots } from "./slots";
import { planEstimateCount } from "./state";
import { templateInputSchema } from "./templates";
import type { ClaimUse, CreativeInputs, CreativeStatus, Grounding } from "./types";

const log = getLogger("creative-generate");

export const CREATIVE_ACTIONS = ["all", "copy", "background", "render"] as const;
export type CreativeAction = (typeof CREATIVE_ACTIONS)[number];
export const PLAN_ACTIONS = ["concepts", "generate"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

/** Injectable paid/slow calls (tests, scripted runs). */
export type GenerateDeps = {
  writeCopy?: typeof writeCopy;
  proposeConcepts?: typeof proposeConcepts;
  generateBackground?: typeof generateBackground;
  renderVersion?: typeof renderVersion;
};

export type CreativeRunResult = {
  creative_id: string;
  status: "ready" | "failed";
  version: number | null;
  template_key: string | null;
  grounding_ok: boolean | null;
  grounding_issues: number;
  renders: number;
  background: boolean;
  cost_usd: number;
  error: string | null;
};

/** Another run holds this creative (`rendering`, updated within 15 min); nothing was spent. */
export class CreativeBusyError extends Error {
  constructor(message = "this creative is already being generated or rendered") {
    super(message);
    this.name = "CreativeBusyError";
  }
}

const msgOf =(err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 500);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ---------- generation_jobs rows (always finished: done or failed) ----------

type JobSpec = {
  clientId: string;
  kind: "content_plan_concepts" | "creative_copy" | "creative_image" | "creative_render";
  provider: "gemini" | "openai" | "chromium";
  model: string | null;
  input: Record<string, unknown>;
};
type JobFinish = {
  output?: Record<string, unknown>;
  prompt_tokens?: number;
  completion_tokens?: number;
  model?: string;
};
/** `cost_usd` is set by the step as soon as money is spent, so a failure after a paid call still records it. */
type JobCtx = { id: string; cost_usd: number };

async function withJob<T>(spec: JobSpec, fn: (ctx: JobCtx) => Promise<{ value: T; finish: JobFinish }>): Promise<{
  value: T;
  ctx: JobCtx;
}> {
  const db = getDb();
  const started = Date.now();
  const { data, error } = await db
    .from("generation_jobs")
    .insert({
      client_id: spec.clientId,
      kind: spec.kind,
      provider: spec.provider,
      model: spec.model,
      status: "running",
      input: spec.input,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job insert failed: ${error?.message ?? "no row"}`);
  const ctx: JobCtx = { id: (data as { id: string }).id, cost_usd: 0 };
  try {
    const { value, finish } = await fn(ctx);
    const { error: doneErr } = await db
      .from("generation_jobs")
      .update({
        status: "done",
        ...(finish.model ? { model: finish.model } : {}),
        prompt_tokens: finish.prompt_tokens ?? null,
        completion_tokens: finish.completion_tokens ?? null,
        cost_usd: ctx.cost_usd,
        output: { ...(finish.output ?? {}), duration_ms: Date.now() - started },
        finished_at: new Date().toISOString(),
      })
      .eq("id", ctx.id);
    // never throw here: the step succeeded (and may have been paid for); a row left `running` is logged
    if (doneErr) log.error({ jobId: ctx.id, err: doneErr.message }, "generate.job_done_write_failed");
    return { value, ctx };
  } catch (err) {
    try {
      const { error: failErr } = await db
        .from("generation_jobs")
        .update({
          status: "failed",
          error: msgOf(err),
          cost_usd: ctx.cost_usd,
          output: { duration_ms: Date.now() - started },
          finished_at: new Date().toISOString(),
        })
        .eq("id", ctx.id);
      if (failErr) log.error({ jobId: ctx.id, err: failErr.message }, "generate.job_fail_write_failed");
    } catch (e) {
      log.error({ jobId: ctx.id, err: String(e) }, "generate.job_fail_write_failed");
    }
    (err as { spent_usd?: number }).spent_usd = ctx.cost_usd;
    throw err;
  }
}

async function clientIdOf(table: "creatives" | "content_plans", id: string): Promise<string> {
  const { data, error } = await getDb().from(table).select("client_id").eq("id", id).maybeSingle();
  if (error) throw new Error(`read ${table} failed: ${error.message}`);
  if (!data) throw new NotFoundError(table === "creatives" ? "creative not found" : "plan not found");
  return (data as { client_id: string }).client_id;
}

async function currentBrandBrain(clientId: string): Promise<BrandProfileData> {
  const client = await getClient(clientId);
  if (!client) throw new NotFoundError("client not found");
  const cur = await getCurrentProfile(clientId);
  if (!cur) {
    throw new Error("This client has no current Brand Brain yet - build and accept one before generating posts.");
  }
  return cur.data;
}

// ---------- one creative ----------

type Ctx = {
  clientId: string;
  creative: CreativeRow;
  plan: PlanRow | null;
  profile: BrandProfileData;
  products: ProductSnapshot[];
  assets: AssetRow[];
  seed: VisualSeed;
  deps: GenerateDeps;
};

/** The version to write into: the current draft, else a new draft (v1 seeded from the Brand Brain). */
async function ensureDraft(
  clientId: string,
  creative: CreativeRow & { versions: VersionRow[] },
  seed: VisualSeed,
): Promise<VersionRow> {
  const latest = creative.versions.find((v) => v.version === creative.current_version) ?? null;
  if (latest?.state === "draft") return latest;
  const grounding: Grounding = latest?.grounding ?? { ok: false, issues: [] };
  await newVersion(clientId, creative.id, latest ? {} : { inputs: seed }, { grounding });
  const fresh = await getCreative(clientId, creative.id);
  const v = fresh.versions.find((x) => x.version === fresh.current_version);
  if (!v) throw new Error("draft version was not created");
  return v;
}

async function copyStep(
  ctx: Ctx,
  v: VersionRow,
  inputs: CreativeInputs,
): Promise<{ inputs: CreativeInputs; copy: VersionRow["copy"]; grounding: Grounding; jobId: string; cost: number; claims: number; claimsUsed: ClaimUse[] }> {
  const { clientId, creative, plan, profile, products } = ctx;
  const concept = conceptForCreative(creative, plan, profile);
  const write = ctx.deps.writeCopy ?? writeCopy;
  const { value, ctx: job } = await withJob(
    {
      clientId,
      kind: "creative_copy",
      provider: "gemini",
      model: env.GOOGLE_GENAI_MODEL,
      input: { creative_id: creative.id, version: v.version, template_key: creative.template_key, title: concept.title },
    },
    async (j) => {
      const out = await write({
        profile,
        products,
        concept,
        platforms: creative.platforms,
        templateKey: creative.template_key,
        kind: creative.kind,
      });
      j.cost_usd = estimateCostUsd(out.usage);
      const next: CreativeInputs = { ...inputs, ...out.inputs, cta_kind: concept.cta_kind };
      if (!out.inputs.body) delete next.body;
      if (!out.inputs.slides) delete next.slides;
      const isReview = creative.template_key === "review";
      const review = isReview ? reviewSource(profile, next.body ?? "") : null;
      const grounding = checkGrounding({
        copy: out.copy,
        inputs: next,
        claimsUsed: out.claims_used,
        profile,
        products,
        reviewText: review?.text ?? null,
        reviewAuthor: review?.author ?? null,
      });
      if (isReview && !review) {
        grounding.issues.push({ platform: "inputs", text: next.body ?? "", reason: "no review fact in the Brand Brain" });
        grounding.ok = false;
      }
      return {
        value: { inputs: next, copy: out.copy, grounding, claims_used: out.claims_used },
        finish: {
          model: out.usage.model,
          prompt_tokens: out.usage.prompt_tokens,
          completion_tokens: out.usage.completion_tokens,
          output: {
            creative_id: creative.id,
            version: v.version,
            grounding_ok: grounding.ok,
            grounding_issues: grounding.issues.length,
            claims_used: out.claims_used,
          },
        },
      };
    },
  );
  await setVersionInputs(clientId, creative.id, v.version, value.inputs);
  await setVersionCopy(clientId, creative.id, v.version, value.copy);
  await setVersionGrounding(clientId, creative.id, v.version, value.grounding);
  // keep the citations so a later edit can re-check grounding against them
  await setVersionAi(clientId, creative.id, v.version, { ...(v.ai ?? {}), claims_used: value.claims_used });
  return {
    inputs: value.inputs,
    copy: value.copy,
    grounding: value.grounding,
    jobId: job.id,
    cost: job.cost_usd,
    claims: value.claims_used.length,
    claimsUsed: value.claims_used,
  };
}

async function backgroundStep(
  ctx: Ctx,
  v: VersionRow,
  inputs: CreativeInputs,
): Promise<{ asset: AssetRow; jobId: string; cost: number }> {
  const { clientId, creative, profile } = ctx;
  const prompt = inputs.background_prompt?.trim()
    ? `${inputs.background_prompt.trim()}. ${NEGATIVE_LIST}.`
    : backgroundPrompt(
        {
          category: profile.business.category?.value ?? null,
          tone: profile.voice.tone.map((t) => t.value),
          colors: { primary: inputs.colors.primary || null, accent: inputs.colors.accent || null },
        },
        creative.template_key,
      );
  const gen = ctx.deps.generateBackground ?? generateBackground;
  const { value, ctx: job } = await withJob(
    {
      clientId,
      kind: "creative_image",
      provider: "openai",
      model: env.OPENAI_IMAGE_MODEL,
      input: { creative_id: creative.id, version: v.version, template_key: creative.template_key, prompt },
    },
    async (j) => {
      const img = await gen({ prompt, size: "1024x1536", quality: env.OPENAI_IMAGE_QUALITY });
      j.cost_usd = imageCostUsd(1, img.usd);
      const asset = await storeRenderPng({
        clientId,
        versionId: v.id,
        aspect: "background",
        slide: null,
        png: img.png,
        tags: ["background"],
        rev: newRenderRevision(),
      });
      return { value: asset, finish: { model: img.model, output: { asset_id: asset.id, bytes: img.png.length } } };
    },
  );
  return { asset: value, jobId: job.id, cost: job.cost_usd };
}

async function renderStep(
  ctx: Ctx,
  v: VersionRow,
  inputs: CreativeInputs,
): Promise<{ renders: number; overflow: unknown[]; jobId: string }> {
  const { clientId, creative, profile, assets } = ctx;
  const parsed = templateInputSchema(creative.template_key).safeParse(inputs);
  if (!parsed.success) {
    throw new RenderInputError(
      `Cannot render ${creative.template_key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  await setVersionInputs(clientId, creative.id, v.version, inputs);
  const render = ctx.deps.renderVersion ?? renderVersion;
  const { value, ctx: job } = await withJob(
    {
      clientId,
      kind: "creative_render",
      provider: "chromium",
      model: null,
      input: { creative_id: creative.id, version: v.version, template_key: creative.template_key, kind: creative.kind },
    },
    async () => {
      const out = await render({
        clientId,
        versionId: v.id,
        creative: { kind: creative.kind, template_key: creative.template_key },
        inputs,
        assets,
        fonts: fontsFromProfile(profile.visuals.fonts),
      });
      await setVersionRenders(clientId, creative.id, v.version, out.renders);
      // every render run writes new paths; drop this version's previous render objects (best-effort)
      const pruned = await pruneVersionRenders(clientId, v.id, out.renders.map((r) => r.asset_id));
      return { value: out, finish: { output: { renders: out.renders.length, overflow: out.overflow, pruned } } };
    },
  );
  return { renders: value.renders.length, overflow: value.overflow, jobId: job.id };
}

/**
 * Run one creative. Steps per action:
 *   all        → copy (when the draft has none) → background (when wanted and not already made) → render
 *   copy       → copy (always, paid) → render
 *   background → background (always, paid; needs OpenAI) → render
 *   render     → render (free)
 * creatives.status is `rendering` while working, then `ready` or `failed` (+ last_error). Step failures never
 * throw: the result says `failed` with the error and the money spent. A grounding miss is not a failure.
 */
export async function runCreative(
  creativeId: string,
  action: CreativeAction,
  opts: { deps?: GenerateDeps; plan?: PlanRow | null; claimed?: boolean } = {},
): Promise<CreativeRunResult> {
  const clientId = await clientIdOf("creatives", creativeId);
  const res: CreativeRunResult = {
    creative_id: creativeId,
    status: "failed",
    version: null,
    template_key: null,
    grounding_ok: null,
    grounding_issues: 0,
    renders: 0,
    background: false,
    cost_usd: 0,
    error: null,
  };
  // claim before any spend; `claimed` = the dispatching route already claimed it (claimCreativeRendering)
  if (opts.claimed) await setCreativeStatus(clientId, creativeId, "rendering", null);
  else if (!(await claimCreativeRendering(clientId, creativeId))) throw new CreativeBusyError();
  let finalStatus: CreativeStatus = "failed";
  let lastError: string | null = null;
  try {
    const detail = await getCreative(clientId, creativeId);
    res.template_key = detail.template_key;
    const profile = await currentBrandBrain(clientId);
    const plan =
      opts.plan !== undefined ? opts.plan : detail.plan_id ? await getPlan(clientId, detail.plan_id) : null;
    const products = await snapshotProducts(clientId);
    const assets = await listAssets(clientId, { includeRenders: true });
    const seed = seedVisuals(profile, products, detail.product_id, assets);
    const ctx: Ctx = { clientId, creative: detail, plan, profile, products, assets, seed, deps: opts.deps ?? {} };

    const v = await ensureDraft(clientId, detail, seed);
    res.version = v.version;
    let inputs = completeInputs(v.inputs, seed);
    const ai: Record<string, unknown> = { ...(v.ai ?? {}) };
    res.grounding_ok = v.grounding?.ok ?? null;
    res.grounding_issues = v.grounding?.issues?.length ?? 0;

    // Ruling 34: a step that changes the draft's copy or background clears its renders first, so the draft can
    // never be approved with images that do not match its copy (renders come back only when the render completes)
    let rendersCleared = false;
    const clearRenders = async () => {
      if (rendersCleared || !(v.renders ?? []).length) return;
      await setVersionRenders(clientId, creativeId, v.version, []);
      rendersCleared = true;
    };

    const hasCopy = !!inputs.headline.trim() && detail.platforms.every((p) => !!v.copy?.[p]?.caption);
    if (action === "copy" || (action === "all" && !hasCopy)) {
      await clearRenders();
      const c = await copyStep(ctx, v, inputs).catch((err) => {
        res.cost_usd += (err as { spent_usd?: number }).spent_usd ?? 0;
        throw err;
      });
      res.cost_usd += c.cost;
      inputs = c.inputs;
      res.grounding_ok = c.grounding.ok;
      res.grounding_issues = c.grounding.issues.length;
      ai.copy_job_id = c.jobId;
      ai.claims_used = c.claimsUsed;
      await setVersionAi(clientId, creativeId, v.version, ai);
    }

    const wantBg =
      action === "background" ||
      (action === "all" &&
        imageNeeded({ templateKey: detail.template_key, inputs, plan, assetIds: new Set(assets.map((a) => a.id)) }));
    if (wantBg) {
      if (!isOpenAiConfigured()) {
        if (action === "background") throw new Error("AI backgrounds are unavailable: OPENAI_API_KEY is not set");
        log.info({ clientId, creativeId }, "generate.background_skipped_no_openai");
      } else {
        await clearRenders();
        const b = await backgroundStep(ctx, v, inputs).catch((err) => {
          res.cost_usd += (err as { spent_usd?: number }).spent_usd ?? 0;
          throw err;
        });
        res.cost_usd += b.cost;
        res.background = true;
        assets.push(b.asset);
        inputs = { ...inputs, background_asset_id: b.asset.id };
        ai.image_job_id = b.jobId;
        await setVersionInputs(clientId, creativeId, v.version, inputs);
        await setVersionAi(clientId, creativeId, v.version, ai);
      }
    }

    const r = await renderStep(ctx, v, inputs);
    res.renders = r.renders;
    ai.render_job_id = r.jobId;
    ai.overflow = r.overflow;
    await setVersionAi(clientId, creativeId, v.version, ai);

    finalStatus = "ready";
    res.status = "ready";
  } catch (err) {
    lastError = msgOf(err);
    res.error = lastError;
    log.warn({ clientId, creativeId, action, err: lastError }, "generate.creative_failed");
  } finally {
    res.cost_usd = round6(res.cost_usd);
    await setCreativeStatus(clientId, creativeId, finalStatus, lastError).catch((e: unknown) =>
      log.error({ clientId, creativeId, err: String(e) }, "generate.status_write_failed"),
    );
  }
  log.info({ clientId, ...res }, "generate.creative_done");
  return res;
}

// ---------- a month plan ----------

export type PlanCreative = Pick<
  CreativeRow,
  "id" | "concept_index" | "status" | "updated_at" | "template_key" | "current_version"
>;

export async function planCreatives(clientId: string, planId: string): Promise<PlanCreative[]> {
  const { data, error } = await getDb()
    .from("creatives")
    .select("id,concept_index,status,updated_at,template_key,current_version")
    .eq("client_id", clientId)
    .eq("plan_id", planId);
  if (error) throw new Error(`read plan creatives failed: ${error.message}`);
  return (data ?? []) as PlanCreative[];
}

export type ConceptsResult = { plan_id: string; concepts: number; cost_usd: number };
export type GenerateResult = {
  plan_id: string;
  processed: number;
  ready: number;
  failed: number;
  pending_count: number;
  spent_usd: number;
  /** AI spend recorded on this plan before this run (counts against CREATIVE_PLAN_BUDGET_USD). */
  spent_before_usd: number;
  cap_usd: number;
  stopped_for_budget: boolean;
  creatives: CreativeRunResult[];
};

/** Latest-version inputs of the given creatives (one read), for the budget unit of a resumed creative. */
export async function latestInputs(
  clientId: string,
  creatives: PlanCreative[],
): Promise<Map<string, Partial<CreativeInputs>>> {
  const out = new Map<string, Partial<CreativeInputs>>();
  const current = new Map(creatives.filter((c) => c.current_version > 0).map((c) => [c.id, c.current_version]));
  if (!current.size) return out;
  const { data, error } = await getDb()
    .from("creative_versions")
    .select("creative_id,version,inputs")
    .eq("client_id", clientId)
    .in("creative_id", [...current.keys()]);
  if (error) throw new Error(`read creative inputs failed: ${error.message}`);
  for (const r of (data ?? []) as { creative_id: string; version: number; inputs: Partial<CreativeInputs> }[]) {
    if (current.get(r.creative_id) === r.version) out.set(r.creative_id, r.inputs ?? {});
  }
  return out;
}

async function planConcepts(clientId: string, planId: string, deps: GenerateDeps): Promise<ConceptsResult> {
  const plan = await getPlan(clientId, planId);
  if (plan.status !== "planning" && plan.status !== "ready") {
    throw new PlanStateError(`concepts can only be planned while planning or ready (plan is ${plan.status})`);
  }
  if (plan.creatives.total > 0) {
    throw new PlanStateError("this plan already has creatives; edit its concepts instead of re-planning");
  }
  const profile = await currentBrandBrain(clientId);
  const products = await snapshotProducts(clientId);
  const month = plan.month.slice(0, 7);
  const count = planEstimateCount(month, plan.posts_per_week, env.CREATIVE_MAX_PER_PLAN);
  const slots = spreadSlots(month, plan.posts_per_week, count);
  const productIds = plan.product_ids.length
    ? plan.product_ids
    : products.filter((p) => p.featured && p.id).map((p) => p.id as string);
  const productIdsBySlot = assignProducts(slots, productIds);
  const propose = deps.proposeConcepts ?? proposeConcepts;
  const { value, ctx } = await withJob(
    {
      clientId,
      kind: "content_plan_concepts",
      provider: "gemini",
      model: env.GOOGLE_GENAI_MODEL,
      input: { plan_id: planId, month, posts_per_week: plan.posts_per_week, slots: slots.length },
    },
    async (j) => {
      const out = await propose({ profile, products, month, slots, platforms: plan.platforms, productIdsBySlot });
      j.cost_usd = estimateCostUsd(out.usage);
      await updatePlanConcepts(clientId, planId, out.concepts);
      return {
        value: out.concepts.length,
        finish: {
          model: out.usage.model,
          prompt_tokens: out.usage.prompt_tokens,
          completion_tokens: out.usage.completion_tokens,
          output: { plan_id: planId, concepts: out.concepts.length, slots: slots.length },
        },
      };
    },
  );
  log.info({ clientId, planId, concepts: value, cost: ctx.cost_usd }, "generate.concepts_done");
  return { plan_id: planId, concepts: value, cost_usd: ctx.cost_usd };
}

async function planGenerate(
  clientId: string,
  planId: string,
  deps: GenerateDeps,
  claimedAt: string | null,
): Promise<GenerateResult> {
  if (!(await claimGenerating(clientId, planId, { claimedAt }))) {
    const p = await getPlan(clientId, planId);
    throw new PlanStateError(
      p.status === "done" ? "plan is done; set it back to ready to generate" : "plan is already generating",
    );
  }
  const result: GenerateResult = {
    plan_id: planId,
    processed: 0,
    ready: 0,
    failed: 0,
    pending_count: 0,
    spent_usd: 0,
    spent_before_usd: 0,
    cap_usd: 0,
    stopped_for_budget: false,
    creatives: [],
  };
  let plan: PlanRow | null = null;
  const errors: string[] = [];
  let fatal: string | null = null;
  try {
    plan = await getPlan(clientId, planId);
    // Ruling 32: stop at min(confirmed × 1.25, plan budget − what earlier runs already spent on this plan).
    // A run started outside the route (CLI) has no confirmed figure and falls back to the plan estimate.
    const spentBefore = (await planSpend(clientId, planId)).total_usd;
    result.spent_before_usd = spentBefore;
    const confirmed = plan.confirmed_estimate_usd ?? plan.estimate_usd ?? env.CREATIVE_PLAN_BUDGET_USD;
    const cap = runCapUsd({ confirmedUsd: confirmed, planBudgetUsd: env.CREATIVE_PLAN_BUDGET_USD, spentBeforeUsd: spentBefore });
    result.cap_usd = round6(cap);
    const existing = await planCreatives(clientId, planId);
    const todo = capToMaxPerPlan(conceptsToGenerate(plan, existing, new Date()), existing, env.CREATIVE_MAX_PER_PLAN);
    const openai = isOpenAiConfigured();
    const priors = todo.map((i) => creativeForConcept(existing, i)).filter((c): c is PlanCreative => !!c);
    const priorInputs = await latestInputs(clientId, priors);
    const assetIds = new Set((await listAssets(clientId, { includeRenders: true })).map((a) => a.id));
    log.info({ clientId, planId, todo: todo.length, cap }, "generate.plan_start");
    for (const idx of todo) {
      const concept = plan.concepts[idx];
      const prior = creativeForConcept(existing, idx);
      // a resumed creative is costed from its own template + latest inputs (an existing background is free)
      const unit = creativeUnitFor(
        prior
          ? { templateKey: prior.template_key, inputs: priorInputs.get(prior.id) ?? {}, plan, assetIds }
          : { templateKey: concept.template_key, inputs: {}, plan, assetIds },
        openai,
        env.OPENAI_IMAGE_USD_PER_IMAGE,
      );
      if (!nextBudgetCheck(result.spent_usd, cap, unit)) {
        result.stopped_for_budget = true;
        log.warn({ clientId, planId, spent: result.spent_usd, cap, unit, left: todo.length - result.processed }, "generate.budget_stop");
        break;
      }
      const creativeId = prior ? prior.id : (await createCreativeFromConcept(clientId, planId, concept, idx)).id;
      let r: CreativeRunResult;
      try {
        r = await runCreative(creativeId, "all", { deps, plan });
      } catch (err) {
        if (!(err instanceof CreativeBusyError)) throw err;
        log.warn({ clientId, planId, creativeId, idx }, "generate.creative_busy_skipped");
        await touchHeartbeat(clientId, planId);
        continue;
      }
      result.processed++;
      result.spent_usd = round6(result.spent_usd + r.cost_usd);
      result.creatives.push(r);
      if (r.status === "ready") result.ready++;
      else {
        result.failed++;
        errors.push(`#${idx + 1} ${concept.title}: ${r.error}`);
      }
      await touchHeartbeat(clientId, planId);
    }
    return result;
  } catch (err) {
    fatal = msgOf(err);
    throw err;
  } finally {
    const parts = [
      fatal,
      errors.length ? `${errors.length} creative(s) failed - ${errors.join(" | ")}` : null,
      result.stopped_for_budget
        ? `budget cap reached ($${result.spent_usd.toFixed(3)} of $${result.cap_usd.toFixed(3)} this run, ` +
          `$${(result.spent_before_usd + result.spent_usd).toFixed(3)} of the $${env.CREATIVE_PLAN_BUDGET_USD.toFixed(2)} plan budget); ` +
          `run Generate again for the rest`
        : null,
    ].filter((s): s is string => !!s);
    try {
      if (plan) result.pending_count = pendingCount(plan, await planCreatives(clientId, planId));
    } catch (e) {
      log.error({ clientId, planId, err: String(e) }, "generate.pending_count_failed");
    }
    await setPlanStatus(clientId, planId, "ready", {
      generating_started_at: null,
      ...(plan ? { pending_count: result.pending_count } : {}),
      last_error: parts.length ? parts.join(" / ").slice(0, 1000) : null,
    }).catch((e: unknown) => log.error({ clientId, planId, err: String(e) }, "generate.plan_status_write_failed"));
    log.info({ clientId, planId, ...result, creatives: result.creatives.length }, "generate.plan_done");
  }
}

/**
 * concepts → one Gemini call proposing a concept per cadence slot (status stays `planning`).
 * generate → claim the plan (`generating`), then sequentially create + run every concept still missing a ready
 *            creative until the budget cap; ends `ready` with pending_count / last_error; always clears
 *            generating_started_at. Re-running resumes. `claimedAt` = the generating_started_at a route claimed.
 */
export async function runPlan(
  planId: string,
  action: PlanAction,
  opts: { deps?: GenerateDeps; claimedAt?: string | null } = {},
): Promise<ConceptsResult | GenerateResult> {
  const clientId = await clientIdOf("content_plans", planId);
  if (action === "concepts") return planConcepts(clientId, planId, opts.deps ?? {});
  return planGenerate(clientId, planId, opts.deps ?? {}, opts.claimedAt ?? null);
}
