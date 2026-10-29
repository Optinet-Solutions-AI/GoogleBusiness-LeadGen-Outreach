/**
 * api/clients/[id]/products/route.ts — POST: add a product. PATCH { order }: reorder products.
 *
 * Inputs:  params.id; POST body ProductInput; PATCH body { order: string[] }
 * Outputs: the updated ProductSnapshot[] (every write also mints an operator profile version)
 * Used by: client detail page (Products tab)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { FeaturedLimitError, ProductInput, createProduct, reorderProducts } from "@/lib/clients/products";
import { NotFoundError, snapshotProducts, VersionConflictError } from "@/lib/clients/profile";

const Reorder = z.object({ order: z.array(z.string().uuid()) });

function mapError(e: unknown) {
  if (e instanceof VersionConflictError) return fail(e.message, 409);
  if (e instanceof FeaturedLimitError) return fail("At most 10 featured products", 400);
  if (e instanceof NotFoundError) return fail(e.message, 404);
  throw e;
}

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = ProductInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid product", 400);
  try {
    await createProduct(params.id, parsed.data);
    return ok(await snapshotProducts(params.id));
  } catch (e) {
    return mapError(e);
  }
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Reorder.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid order", 400);
  try {
    await reorderProducts(params.id, parsed.data.order);
    return ok(await snapshotProducts(params.id));
  } catch (e) {
    return mapError(e);
  }
});
