/**
 * creatives.ts — creatives, immutable versions and reviews (create, list, version, review, delete).
 *
 * Inputs:  clientId, creative ids, concepts / single-post inputs, version patches, review actions
 * Outputs: creatives, creative_versions and creative_reviews rows; creatives.current_version
 * Used by: /api/clients/[id]/creatives*, creative generation job (setVersion* helpers)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { NotFoundError, VersionConflictError } from "@/lib/clients/profile";
import { canApprove, editCreatesDraft, nextStateForReview, type ReviewAction } from "./state";
import {
  ASPECTS,
  type Aspect,
  type Concept,
  type CreativeCopy,
  type CreativeInputs,
  type CreativeKind,
  type CreativeStatus,
  type Grounding,
  type Platform,
  type RenderRef,
  type TemplateKey,
  type VersionState,
} from "./types";

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

export type CreativeRow = {
  id: string;
  client_id: string;
  plan_id: string | null;
  kind: CreativeKind;
  slot_date: string | null;
  platforms: Platform[];
  template_key: TemplateKey;
  product_id: string | null;
  title: string | null;
  status: CreativeStatus;
  current_version: number;
  concept_index: number | null;
  brief: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type VersionRow = {
  id: string;
  creative_id: string;
  client_id: string;
  version: number;
  state: VersionState;
  inputs: Partial<CreativeInputs>;
  copy: CreativeCopy;
  grounding: Grounding;
  renders: RenderRef[];
  ai: Record<string, unknown>;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export type ReviewRow = {
  id: string;
  version_id: string;
  client_id: string;
  action: ReviewAction | "edit";
  note: string | null;
  actor: string;
  created_at: string;
};

export type CreativeListRow = CreativeRow & {
  latest: Pick<VersionRow, "version" | "state" | "grounding" | "renders"> | null;
};

export type SingleCreativeInput = {
  title: string;
  brief: string;
  template_key: TemplateKey;
  kind: CreativeKind;
  platforms: Platform[];
  slot_date?: string | null;
  product_id?: string | null;
};

async function insertCreative(row: Record<string, unknown>): Promise<CreativeRow> {
  const { data, error } = await getDb().from("creatives").insert(row).select("*").single();
  if (error) throw new Error(`create creative failed: ${error.message}`);
  return data as CreativeRow;
}

export function createCreativeFromConcept(
  clientId: string,
  planId: string,
  concept: Concept,
  conceptIndex: number,
): Promise<CreativeRow> {
  return insertCreative({
    client_id: clientId,
    plan_id: planId,
    kind: concept.kind,
    slot_date: concept.slot_date,
    platforms: concept.platforms,
    template_key: concept.template_key,
    product_id: concept.product_id,
    title: concept.title,
    concept_index: conceptIndex,
  });
}

export function createSingleCreative(clientId: string, input: SingleCreativeInput): Promise<CreativeRow> {
  return insertCreative({
    client_id: clientId,
    plan_id: null,
    kind: input.kind,
    slot_date: input.slot_date ?? null,
    platforms: input.platforms,
    template_key: input.template_key,
    product_id: input.product_id ?? null,
    title: input.title,
    brief: input.brief,
  });
}

async function readCreative(clientId: string, cid: string): Promise<CreativeRow> {
  const { data, error } = await getDb()
    .from("creatives")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", cid)
    .maybeSingle();
  if (error) throw new Error(`read creative failed: ${error.message}`);
  if (!data) throw new NotFoundError("creative not found");
  return data as CreativeRow;
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [`${month}-01`, `${next}-01`];
}

type LatestRow = NonNullable<CreativeListRow["latest"]> & { creative_id: string };

export async function listCreatives(
  clientId: string,
  filter: { month?: string; state?: VersionState; platform?: Platform } = {},
): Promise<CreativeListRow[]> {
  const db = getDb();
  let q = db.from("creatives").select("*").eq("client_id", clientId);
  if (filter.month) {
    const [from, to] = monthRange(filter.month);
    q = q.gte("slot_date", from).lt("slot_date", to);
  }
  if (filter.platform) q = q.contains("platforms", [filter.platform]);
  const { data, error } = await q.order("slot_date", { ascending: true, nullsFirst: false }).order("created_at");
  if (error) throw new Error(`list creatives failed: ${error.message}`);
  const creatives = (data ?? []) as CreativeRow[];
  if (!creatives.length) return [];

  const { data: vs, error: vErr } = await db
    .from("creative_versions")
    .select("creative_id,version,state,grounding,renders")
    .eq("client_id", clientId)
    .neq("state", "superseded")
    .in(
      "creative_id",
      creatives.map((c) => c.id),
    );
  if (vErr) throw new Error(`list versions failed: ${vErr.message}`);
  const latest = new Map<string, LatestRow>();
  for (const v of (vs ?? []) as LatestRow[]) {
    const cur = latest.get(v.creative_id);
    if (!cur || v.version > cur.version) latest.set(v.creative_id, v);
  }
  const rows: CreativeListRow[] = creatives.map((c) => {
    const l = latest.get(c.id);
    return { ...c, latest: l ? { version: l.version, state: l.state, grounding: l.grounding, renders: l.renders } : null };
  });
  return filter.state ? rows.filter((r) => r.latest?.state === filter.state) : rows;
}

export async function getCreative(
  clientId: string,
  cid: string,
): Promise<CreativeRow & { versions: VersionRow[]; reviews: ReviewRow[] }> {
  const creative = await readCreative(clientId, cid);
  const db = getDb();
  const { data: versions, error } = await db
    .from("creative_versions")
    .select("*")
    .eq("client_id", clientId)
    .eq("creative_id", cid)
    .order("version", { ascending: false });
  if (error) throw new Error(`read versions failed: ${error.message}`);
  const vs = (versions ?? []) as VersionRow[];
  let reviews: ReviewRow[] = [];
  if (vs.length) {
    const { data: rv, error: rErr } = await db
      .from("creative_reviews")
      .select("*")
      .eq("client_id", clientId)
      .in(
        "version_id",
        vs.map((v) => v.id),
      )
      .order("created_at", { ascending: false });
    if (rErr) throw new Error(`read reviews failed: ${rErr.message}`);
    reviews = (rv ?? []) as ReviewRow[];
  }
  return { ...creative, versions: vs, reviews };
}

export async function deleteCreative(clientId: string, cid: string): Promise<void> {
  await readCreative(clientId, cid);
  const { error } = await getDb().from("creatives").delete().eq("client_id", clientId).eq("id", cid);
  if (error) throw new Error(`delete creative failed: ${error.message}`);
}

async function readVersion(clientId: string, cid: string, version: number): Promise<VersionRow | null> {
  const { data, error } = await getDb()
    .from("creative_versions")
    .select("*")
    .eq("client_id", clientId)
    .eq("creative_id", cid)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`read version failed: ${error.message}`);
  return (data as VersionRow | null) ?? null;
}

export async function newVersion(
  clientId: string,
  cid: string,
  patch: { inputs?: Partial<CreativeInputs>; copy?: CreativeCopy; note?: string | null },
  opts: { grounding: Grounding },
): Promise<{ version: number; id: string }> {
  const db = getDb();
  const creative = await readCreative(clientId, cid);
  const current = creative.current_version;
  const next = current + 1;
  const prev = current > 0 ? await readVersion(clientId, cid, current) : null;

  // One conditional update claims the version number; zero rows = someone else got there first.
  const { data: claimed, error: claimErr } = await db
    .from("creatives")
    .update({ current_version: next })
    .eq("id", cid)
    .eq("client_id", clientId)
    .eq("current_version", current)
    .select("current_version");
  if (claimErr) throw new Error(`claim version failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) throw new VersionConflictError();

  const { data: ins, error: insErr } = await db
    .from("creative_versions")
    .insert({
      creative_id: cid,
      client_id: clientId,
      version: next,
      state: "draft",
      inputs: { ...(prev?.inputs ?? {}), ...(patch.inputs ?? {}) },
      copy: { ...(prev?.copy ?? {}), ...(patch.copy ?? {}) },
      grounding: opts.grounding,
      renders: [],
      note: patch.note ?? null,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`insert version failed: ${insErr.message}`);

  if (prev && prev.state !== "superseded") {
    const { error } = await db
      .from("creative_versions")
      .update({ state: "superseded" })
      .eq("id", prev.id)
      .neq("state", "superseded");
    if (error) throw new Error(`supersede version failed: ${error.message}`);
    // editing a draft just replaces it; editing anything reviewed is an audited edit
    if (editCreatesDraft(prev.state)) {
      const { error: rErr } = await db.from("creative_reviews").insert({
        version_id: prev.id,
        client_id: clientId,
        action: "edit",
        note: patch.note ?? null,
      });
      if (rErr) throw new Error(`record edit review failed: ${rErr.message}`);
    }
  }
  return { version: next, id: (ins as { id: string }).id };
}

type VersionPatch = Partial<Pick<VersionRow, "ai" | "copy" | "renders" | "grounding" | "inputs">>;

async function patchDraftVersion(clientId: string, cid: string, version: number, patch: VersionPatch): Promise<void> {
  const { data, error } = await getDb()
    .from("creative_versions")
    .update(patch)
    .eq("client_id", clientId)
    .eq("creative_id", cid)
    .eq("version", version)
    .eq("state", "draft")
    .select("id");
  if (error) throw new Error(`update version failed: ${error.message}`);
  if (!data || data.length === 0) throw new ReviewError("version is not an editable draft");
}

export const setVersionAi = (clientId: string, cid: string, version: number, ai: Record<string, unknown>) =>
  patchDraftVersion(clientId, cid, version, { ai });
export const setVersionCopy = (clientId: string, cid: string, version: number, copy: CreativeCopy) =>
  patchDraftVersion(clientId, cid, version, { copy });
export const setVersionRenders = (clientId: string, cid: string, version: number, renders: RenderRef[]) =>
  patchDraftVersion(clientId, cid, version, { renders });
export const setVersionGrounding = (clientId: string, cid: string, version: number, grounding: Grounding) =>
  patchDraftVersion(clientId, cid, version, { grounding });

export async function setCreativeStatus(
  clientId: string,
  cid: string,
  status: CreativeStatus,
  lastError: string | null = null,
): Promise<void> {
  const { error } = await getDb()
    .from("creatives")
    .update({ status, last_error: lastError })
    .eq("client_id", clientId)
    .eq("id", cid);
  if (error) throw new Error(`set creative status failed: ${error.message}`);
}

export async function reviewVersion(
  clientId: string,
  cid: string,
  version: number,
  action: ReviewAction,
  note?: string | null,
  requiredAspects: readonly Aspect[] = ASPECTS,
): Promise<VersionRow> {
  const v = await readVersion(clientId, cid, version);
  if (!v) throw new NotFoundError("version not found");
  const next = nextStateForReview(v.state, action);
  if (next instanceof Error) throw new ReviewError(next.message);
  if (action === "approve") {
    const verdict = canApprove(v, requiredAspects);
    if (!verdict.ok) throw new ReviewError(verdict.reason ?? "cannot approve");
  }
  const db = getDb();
  // conditional on state='draft' so two reviewers cannot both decide the same version
  const { data, error } = await db
    .from("creative_versions")
    .update({ state: next, reviewed_at: new Date().toISOString(), reviewed_by: "operator" })
    .eq("id", v.id)
    .eq("state", "draft")
    .select("*");
  if (error) {
    if (error.code === "23505") throw new ReviewError("another version of this creative is already approved");
    throw new Error(`review failed: ${error.message}`);
  }
  if (!data || data.length === 0) throw new ReviewError("version was already reviewed");
  const { error: rErr } = await db
    .from("creative_reviews")
    .insert({ version_id: v.id, client_id: clientId, action, note: note ?? null });
  if (rErr) throw new Error(`record review failed: ${rErr.message}`);
  return data[0] as VersionRow;
}
