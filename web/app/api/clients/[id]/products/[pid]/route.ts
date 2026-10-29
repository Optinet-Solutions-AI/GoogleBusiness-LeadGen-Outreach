/**
 * api/clients/[id]/products/[pid]/route.ts — PATCH: edit a product. DELETE: remove it.
 *
 * Inputs:  params.id, params.pid; PATCH body = partial ProductInput
 * Outputs: the updated ProductSnapshot[] (every write also mints an operator profile version)
 * Used by: client detail page (Products tab)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { FeaturedLimitError, ProductInput, deleteProduct, updateProduct } from "@/lib/clients/products";
import { NotFoundError, snapshotProducts, VersionConflictError } from "@/lib/clients/profile";

const Patch = ProductInput.partial();

function mapError(e: unknown) {
  if (e instanceof VersionConflictError) return fail(e.message, 409);
  if (e instanceof FeaturedLimitError) return fail("At most 10 featured products", 400);
  if (e instanceof NotFoundError) return fail(e.message, 404);
  throw e;
}

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid product", 400);
  try {
    await updateProduct(params.id, params.pid, parsed.data);
    return ok(await snapshotProducts(params.id));
  } catch (e) {
    return mapError(e);
  }
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  try {
    await deleteProduct(params.id, params.pid);
    return ok(await snapshotProducts(params.id));
  } catch (e) {
    return mapError(e);
  }
});
