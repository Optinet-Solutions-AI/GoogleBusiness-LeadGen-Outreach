/**
 * products.ts — operator CRUD for a client's products; every write ends with a new operator profile version.
 *
 * Inputs:  clientId, ProductInput / patches / ordered ids
 * Outputs: brand_products rows, brand_assets.product_id links, a new brand_profiles version (note "products")
 * Used by: /api/clients/[id]/products routes
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getClient } from "./clients";
import {
  getCurrentProfile,
  linkProductAssets as linkAssets,
  MAX_FEATURED,
  NotFoundError,
  saveProfileVersion,
  snapshotProducts,
} from "./profile";
import { EMPTY_PROFILE } from "./types";

export const ProductInput = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  price: z.string().nullish(),
  category: z.string().nullish(),
  featured: z.boolean().optional(),
  image_asset_ids: z.array(z.string().uuid()).optional(),
});
export type ProductInput = z.infer<typeof ProductInput>;

export class FeaturedLimitError extends Error {
  constructor() {
    super(`At most ${MAX_FEATURED} featured products`);
    this.name = "FeaturedLimitError";
  }
}

export type ProductRow = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  price: string | null;
  category: string | null;
  featured: boolean;
  sort: number;
  source: { kind: string } | null;
  confirmed: boolean;
};

/** Product rows are the current state; each version snapshots them, so every write mints a version. */
async function commitProductsVersion(clientId: string): Promise<void> {
  const client = await getClient(clientId);
  if (!client) throw new NotFoundError("client not found");
  const products = await snapshotProducts(clientId);
  const current = await getCurrentProfile(clientId);
  // Version numbers are shared with drafts, so guard on the client's counter rather than the current profile's.
  await saveProfileVersion(
    clientId,
    { ...(current?.data ?? EMPTY_PROFILE), products },
    { writtenBy: "operator", state: "current", note: "products", expectedVersion: client.current_version },
  );
}

async function assertFeaturedRoom(clientId: string, excludeId?: string): Promise<void> {
  let q = getDb()
    .from("brand_products")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("featured", true);
  if (excludeId) q = q.neq("id", excludeId);
  const { count, error } = await q;
  if (error) throw new Error(`count featured failed: ${error.message}`);
  if ((count ?? 0) >= MAX_FEATURED) throw new FeaturedLimitError();
}

async function getProductRow(clientId: string, pid: string): Promise<ProductRow> {
  const { data, error } = await getDb()
    .from("brand_products")
    .select("*")
    .eq("id", pid)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`read product failed: ${error.message}`);
  if (!data) throw new NotFoundError("product not found");
  return data as ProductRow;
}

export async function createProduct(clientId: string, input: ProductInput): Promise<ProductRow> {
  if (!(await getClient(clientId))) throw new NotFoundError("client not found");
  const db = getDb();
  if (input.featured) await assertFeaturedRoom(clientId);
  const { data: top, error: tErr } = await db
    .from("brand_products")
    .select("sort")
    .eq("client_id", clientId)
    .order("sort", { ascending: false })
    .limit(1);
  if (tErr) throw new Error(`read sort failed: ${tErr.message}`);
  const sort = ((top ?? [])[0] as { sort: number } | undefined)?.sort ?? -1;
  const { data, error } = await db
    .from("brand_products")
    .insert({
      client_id: clientId,
      name: input.name,
      description: input.description ?? null,
      price: input.price ?? null,
      category: input.category ?? null,
      featured: input.featured ?? false,
      sort: sort + 1,
      source: { kind: "operator" },
      confirmed: true,
    })
    .select("*")
    .single();
  if (error) throw new Error(`create product failed: ${error.message}`);
  const row = data as ProductRow;
  if (input.image_asset_ids?.length) await linkAssets(clientId, row.id, input.image_asset_ids);
  await commitProductsVersion(clientId);
  return row;
}

export async function updateProduct(clientId: string, pid: string, patch: Partial<ProductInput>): Promise<ProductRow> {
  await getProductRow(clientId, pid);
  if (patch.featured) await assertFeaturedRoom(clientId, pid);
  const fields: Record<string, unknown> = {};
  for (const k of ["name", "description", "price", "category", "featured"] as const) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  if (Object.keys(fields).length) {
    const { error } = await getDb().from("brand_products").update(fields).eq("id", pid).eq("client_id", clientId);
    if (error) throw new Error(`update product failed: ${error.message}`);
  }
  if (patch.image_asset_ids) await linkAssets(clientId, pid, patch.image_asset_ids);
  await commitProductsVersion(clientId);
  return getProductRow(clientId, pid);
}

export async function deleteProduct(clientId: string, pid: string): Promise<void> {
  await getProductRow(clientId, pid);
  const { error } = await getDb().from("brand_products").delete().eq("id", pid).eq("client_id", clientId);
  if (error) throw new Error(`delete product failed: ${error.message}`);
  await commitProductsVersion(clientId);
}

/** Listed ids take sort 0..n-1 in order; unlisted products keep their relative order after them. */
export async function reorderProducts(clientId: string, ids: string[]): Promise<void> {
  if (!(await getClient(clientId))) throw new NotFoundError("client not found");
  const existing = await snapshotProducts(clientId);
  const known = new Set(existing.map((p) => p.id));
  const listed = [...new Set(ids)].filter((id) => known.has(id));
  const rest = existing.filter((p) => !listed.includes(p.id as string)).map((p) => p.id as string);
  const db = getDb();
  for (const [i, id] of [...listed, ...rest].entries()) {
    const { error } = await db.from("brand_products").update({ sort: i }).eq("id", id).eq("client_id", clientId);
    if (error) throw new Error(`reorder failed: ${error.message}`);
  }
  await commitProductsVersion(clientId);
}
