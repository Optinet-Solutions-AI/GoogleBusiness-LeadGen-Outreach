/**
 * api/clients/[id]/brain/draft/route.ts — POST: accept / discard / merge the pending AI draft.
 *
 * Inputs:  params.id; body { action: "accept"|"discard"|"merge", paths? }
 * Outputs: { version } (null on discard)
 * Used by: client detail page (draft review)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { applyDraft, InvalidPathsError, NotFoundError, VersionConflictError } from "@/lib/clients/profile";

const Body = z.object({
  action: z.enum(["accept", "discard", "merge"]),
  paths: z.array(z.string()).optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  if (parsed.data.action === "merge" && !parsed.data.paths?.length) return fail("paths required for merge", 400);
  if (!(await getClient(params.id))) return fail("client not found", 404);
  try {
    return ok(await applyDraft(params.id, parsed.data.action, parsed.data.paths));
  } catch (e) {
    if (e instanceof InvalidPathsError) return fail(e.message, 400);
    if (e instanceof NotFoundError) return fail(e.message, 404);
    if (e instanceof VersionConflictError) return fail(e.message, 409);
    throw e;
  }
});
