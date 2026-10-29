/**
 * api/clients/[id]/brain/route.ts — GET: current profile + pending draft + diff. PUT: save an operator version.
 *
 * Inputs:  params.id; PUT body { data: BrandProfileData, note?, expected_version }
 * Outputs: GET { current, draft, diff_paths }; PUT { version }
 * Used by: client detail page (Brand Brain editor)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { diffPaths } from "@/lib/clients/facts";
import {
  getCurrentProfile,
  getDraft,
  materializeProducts,
  saveProfileVersion,
  VersionConflictError,
} from "@/lib/clients/profile";
import { BrandProfileData } from "@/lib/clients/types";

const Put = z.object({
  data: BrandProfileData,
  note: z.string().nullish(),
  expected_version: z.number().int().min(0),
});

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!(await getClient(params.id))) return fail("client not found", 404);
  const [current, draft] = await Promise.all([getCurrentProfile(params.id), getDraft(params.id)]);
  return ok({ current, draft, diff_paths: current && draft ? diffPaths(current.data, draft.data) : [] });
});

export const PUT = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Put.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid profile", 400);
  if (!(await getClient(params.id))) return fail("client not found", 404);
  try {
    const saved = await saveProfileVersion(params.id, parsed.data.data, {
      writtenBy: "operator",
      state: "current",
      note: parsed.data.note,
      expectedVersion: parsed.data.expected_version,
    });
    await materializeProducts(params.id, parsed.data.data.products);
    return ok(saved);
  } catch (e) {
    if (e instanceof VersionConflictError) return fail(e.message, 409);
    throw e;
  }
});
