/**
 * profile.ts — versioned brand profiles: save/list/restore, AI drafts, product row materialisation.
 *
 * Inputs:  clientId, BrandProfileData, version numbers, draft actions
 * Outputs: brand_profiles rows (every save = new version; a new draft retires older drafts), brand_products rows,
 *          brand_assets.product_id links, clients.current_version
 * Used by: /api/clients/[id]/brain*, Brand Brain build stage
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getClient } from "./clients";
import { diffPaths, mergeDraft } from "./facts";
import { BrandProfileData, type ProductSnapshot } from "./types";

export class VersionConflictError extends Error {
  constructor() {
    super("A newer version was saved; reload and try again.");
    this.name = "VersionConflictError";
  }
}

export class InvalidPathsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPathsError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export const MAX_FEATURED = 10;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function allocateVersion(current: number, expected: number | undefined): number {
  if (expected !== undefined && expected !== current) throw new VersionConflictError();
  return current + 1;
}

/** Keep the first MAX_FEATURED featured products by `sort`; the rest are un-featured. Order preserved. */
export function capFeatured(products: ProductSnapshot[]): ProductSnapshot[] {
  const keep = new Set(
    products
      .filter((p) => p.featured)
      .sort((a, b) => a.sort - b.sort)
      .slice(0, MAX_FEATURED),
  );
  return products.map((p) => (p.featured && !keep.has(p) ? { ...p, featured: false } : p));
}

/** Copy of the profile with the featured cap applied to its products snapshot (every writer goes through this). */
export function prepareProfileForSave(data: BrandProfileData): BrandProfileData {
  return { ...data, products: capFeatured(data.products) };
}

type VersionRow = {
  version: number;
  written_by: "ai" | "operator";
  state: "current" | "superseded" | "pending_review" | "discarded";
  note: string | null;
  created_at: string;
};

export type SaveOpts = {
  writtenBy: "ai" | "operator";
  state: "current" | "pending_review";
  note?: string | null;
  jobId?: string | null;
  expectedVersion?: number;
};

export async function saveProfileVersion(
  clientId: string,
  data: BrandProfileData,
  opts: SaveOpts,
): Promise<{ version: number }> {
  const db = getDb();
  const client = await getClient(clientId);
  if (!client) throw new NotFoundError("client not found");
  const expected = opts.expectedVersion ?? client.current_version;
  const next = allocateVersion(client.current_version, opts.expectedVersion);

  // One conditional update claims the version number; zero rows = someone else got there first.
  const { data: claimed, error: claimErr } = await db
    .from("clients")
    .update({ current_version: next })
    .eq("id", clientId)
    .eq("current_version", expected)
    .select("current_version");
  if (claimErr) throw new Error(`claim version failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) throw new VersionConflictError();

  let superseded: number[] = [];
  if (opts.state === "current") {
    const { data: prev, error } = await db
      .from("brand_profiles")
      .update({ state: "superseded" })
      .eq("client_id", clientId)
      .eq("state", "current")
      .select("version");
    if (error) throw new Error(`supersede failed: ${error.message}`);
    superseded = ((prev ?? []) as { version: number }[]).map((r) => r.version);
  }
  const { error: insErr } = await db.from("brand_profiles").insert({
    client_id: clientId,
    version: next,
    written_by: opts.writtenBy,
    state: opts.state,
    note: opts.note ?? null,
    data: prepareProfileForSave(data),
    job_id: opts.jobId ?? null,
  });
  if (insErr) {
    // Never leave the client without a current profile: best-effort re-promote what we just superseded.
    if (superseded.length) {
      await db
        .from("brand_profiles")
        .update({ state: "current" })
        .eq("client_id", clientId)
        .in("version", superseded);
    }
    throw new Error(`insert profile failed: ${insErr.message}`);
  }
  if (opts.state === "pending_review") {
    // Only one draft is ever reviewable: retire older ones so they cannot resurface after accept/discard.
    const { error: retireErr } = await db
      .from("brand_profiles")
      .update({ state: "discarded" })
      .eq("client_id", clientId)
      .eq("state", "pending_review")
      .neq("version", next);
    if (retireErr) throw new Error(`retire older drafts failed: ${retireErr.message}`);
  }
  return { version: next };
}

/** Accepting a draft writes it as a NEW current version, so the client counter moves and a stale editor 409s. */
export function acceptDraftSaveOpts(draftVersion: number): SaveOpts {
  return { writtenBy: "operator", state: "current", note: `Accepted draft v${draftVersion}` };
}

async function latestByState(
  clientId: string,
  state: string,
): Promise<{ version: number; data: BrandProfileData } | null> {
  const { data, error } = await getDb()
    .from("brand_profiles")
    .select("version,data")
    .eq("client_id", clientId)
    .eq("state", state)
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw new Error(`read profile failed: ${error.message}`);
  const row = (data ?? [])[0] as { version: number; data: BrandProfileData } | undefined;
  return row ? { version: row.version, data: row.data } : null;
}

export const getCurrentProfile = (clientId: string) => latestByState(clientId, "current");
export const getDraft = (clientId: string) => latestByState(clientId, "pending_review");

export async function listVersions(clientId: string): Promise<VersionRow[]> {
  const { data, error } = await getDb()
    .from("brand_profiles")
    .select("version,written_by,state,note,created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false });
  if (error) throw new Error(`list versions failed: ${error.message}`);
  return (data ?? []) as VersionRow[];
}

export async function getVersion(
  clientId: string,
  v: number,
): Promise<{ version: number; state: string; data: BrandProfileData } | null> {
  const { data, error } = await getDb()
    .from("brand_profiles")
    .select("version,state,data")
    .eq("client_id", clientId)
    .eq("version", v)
    .maybeSingle();
  if (error) throw new Error(`get version failed: ${error.message}`);
  return (data as { version: number; state: string; data: BrandProfileData } | null) ?? null;
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  category: string | null;
  featured: boolean;
  sort: number;
  source: ProductSnapshot["source"] | null;
  confirmed: boolean;
};

export async function snapshotProducts(clientId: string): Promise<ProductSnapshot[]> {
  const db = getDb();
  const { data: rows, error } = await db
    .from("brand_products")
    .select("id,name,description,price,category,featured,sort,source,confirmed")
    .eq("client_id", clientId)
    .order("sort", { ascending: true });
  if (error) throw new Error(`read products failed: ${error.message}`);
  const { data: assets, error: aErr } = await db
    .from("brand_assets")
    .select("id,product_id")
    .eq("client_id", clientId)
    .neq("origin", "render")
    .not("product_id", "is", null);
  if (aErr) throw new Error(`read product assets failed: ${aErr.message}`);
  const byProduct = new Map<string, string[]>();
  for (const a of (assets ?? []) as { id: string; product_id: string }[]) {
    byProduct.set(a.product_id, [...(byProduct.get(a.product_id) ?? []), a.id]);
  }
  return ((rows ?? []) as ProductRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    price: r.price,
    category: r.category,
    featured: r.featured,
    sort: r.sort,
    image_asset_ids: byProduct.get(r.id) ?? [],
    source: r.source ?? { kind: "operator" as const },
    confirmed: r.confirmed,
  }));
}

/** Point exactly `assetIds` (this client's only) at the product; unlink any other asset currently on it. */
export async function linkProductAssets(clientId: string, pid: string, assetIds: string[]): Promise<void> {
  const db = getDb();
  let clear = db
    .from("brand_assets")
    .update({ product_id: null })
    .eq("client_id", clientId)
    .eq("product_id", pid)
    .neq("origin", "render");
  if (assetIds.length) clear = clear.not("id", "in", `(${assetIds.join(",")})`);
  const { error: cErr } = await clear;
  if (cErr) throw new Error(`unlink assets failed: ${cErr.message}`);
  if (assetIds.length) {
    const { error } = await db
      .from("brand_assets")
      .update({ product_id: pid })
      .eq("client_id", clientId)
      .neq("origin", "render")
      .in("id", assetIds);
    if (error) throw new Error(`link assets failed: ${error.message}`);
  }
}

export async function materializeProducts(clientId: string, products: ProductSnapshot[]): Promise<void> {
  const db = getDb();
  // dedupe by lower(name), first wins; then cap featured
  const seen = new Set<string>();
  const unique = products.filter((p) => {
    const k = p.name.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const capped = capFeatured(unique);

  const { data: existing, error } = await db.from("brand_products").select("id,name").eq("client_id", clientId);
  if (error) throw new Error(`read products failed: ${error.message}`);
  const byName = new Map(
    ((existing ?? []) as { id: string; name: string }[]).map((r) => [r.name.trim().toLowerCase(), r.id]),
  );
  const { data: readyRows, error: aErr } = await db
    .from("brand_assets")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "ready")
    .neq("origin", "render");
  if (aErr) throw new Error(`read assets failed: ${aErr.message}`);
  const ready = new Set(((readyRows ?? []) as { id: string }[]).map((r) => r.id));

  const keepIds = new Set<string>();
  for (const p of capped) {
    const fields = {
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      featured: p.featured,
      sort: p.sort,
      source: p.source,
      confirmed: p.confirmed,
    };
    let id = byName.get(p.name.trim().toLowerCase());
    if (id) {
      const { error: uErr } = await db.from("brand_products").update(fields).eq("id", id);
      if (uErr) throw new Error(`update product failed: ${uErr.message}`);
    } else {
      const { data: ins, error: iErr } = await db
        .from("brand_products")
        .insert({ client_id: clientId, ...fields })
        .select("id")
        .single();
      if (iErr) throw new Error(`insert product failed: ${iErr.message}`);
      id = (ins as { id: string }).id;
    }
    keepIds.add(id);
    // the snapshot's photos become the product's linked assets (this client's ready assets only)
    await linkProductAssets(clientId, id, [...new Set(p.image_asset_ids)].filter((a) => ready.has(a)));
  }
  const stale = [...byName.values()].filter((id) => !keepIds.has(id));
  if (stale.length) {
    const { error: dErr } = await db.from("brand_products").delete().in("id", stale);
    if (dErr) throw new Error(`delete products failed: ${dErr.message}`);
  }
}

export async function restoreVersion(clientId: string, v: number): Promise<{ version: number }> {
  const row = await getVersion(clientId, v);
  if (!row) throw new NotFoundError("version not found");
  const data = BrandProfileData.parse(row.data);
  const saved = await saveProfileVersion(clientId, data, {
    writtenBy: "operator",
    state: "current",
    note: `Restored from version ${v}`,
  });
  await materializeProducts(clientId, data.products);
  return saved;
}

function assertSafePaths(paths: string[], allowed: string[]): void {
  const ok = new Set(allowed);
  for (const p of paths) {
    if (p.split(/[.[\]]+/).some((seg) => FORBIDDEN_SEGMENTS.has(seg))) {
      throw new InvalidPathsError(`invalid path: ${p}`);
    }
    if (!ok.has(p)) throw new InvalidPathsError(`path not in draft diff: ${p}`);
  }
}

export async function applyDraft(
  clientId: string,
  action: "accept" | "discard" | "merge",
  paths: string[] = [],
): Promise<{ version: number | null }> {
  const db = getDb();
  const draft = await getDraft(clientId);
  if (!draft) throw new NotFoundError("no draft to review");
  // retires this draft and any older one still pending (rows from before drafts retired each other)
  const retireDrafts = async () => {
    const { error } = await db
      .from("brand_profiles")
      .update({ state: "discarded" })
      .eq("client_id", clientId)
      .eq("state", "pending_review")
      .lte("version", draft.version);
    if (error) throw new Error(`update draft failed: ${error.message}`);
  };

  if (action === "discard") {
    await retireDrafts();
    return { version: null };
  }
  if (action === "accept") {
    // a new current version (bumps clients.current_version) rather than flipping the draft row in place
    const saved = await saveProfileVersion(clientId, draft.data, acceptDraftSaveOpts(draft.version));
    await materializeProducts(clientId, draft.data.products);
    await retireDrafts();
    return saved;
  }
  // merge
  const current = await getCurrentProfile(clientId);
  if (!current) throw new NotFoundError("no current profile to merge into");
  assertSafePaths(paths, diffPaths(current.data, draft.data));
  const merged = mergeDraft(current.data, draft.data, paths);
  const saved = await saveProfileVersion(clientId, merged, {
    writtenBy: "operator",
    state: "current",
    note: `Merged ${paths.length} change(s) from draft v${draft.version}`,
  });
  await materializeProducts(clientId, merged.products);
  await retireDrafts();
  return saved;
}
