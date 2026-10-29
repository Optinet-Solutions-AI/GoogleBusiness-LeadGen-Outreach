/**
 * edit.ts — merge an operator edit into a creative's latest version and run the synchronous checks.
 *
 * Inputs:  clientId, creative id, an edit { inputs?, copy?, note? }
 * Outputs: the version patch plus the grounding verdict (grounding + caption-limit issues merged)
 * Used by: POST /api/clients/:id/creatives/:cid/versions
 */
import "@/lib/server-guard";
import { z } from "zod";
import { listAssets } from "@/lib/clients/assets";
import { getCurrentProfile, NotFoundError, snapshotProducts } from "@/lib/clients/profile";
import { getCreative } from "./creatives";
import { checkGrounding } from "./grounding";
import { checkCaptionLimits } from "./limits";
import { completeInputs, reviewSource, seedVisuals } from "./select";
import { ClaimUseSchema, CreativeCopySchema, CreativeInputsSchema, type CreativeCopy, type Grounding } from "./types";

export const EditSchema = z.object({
  inputs: CreativeInputsSchema.partial().optional(),
  copy: CreativeCopySchema.optional(),
  note: z.string().nullable().optional(),
});
export type Edit = z.infer<typeof EditSchema>;

export async function prepareEdit(clientId: string, cid: string, edit: Edit) {
  const creative = await getCreative(clientId, cid);
  const latest = creative.versions[0];
  const cur = await getCurrentProfile(clientId);
  if (!cur) throw new NotFoundError("This client has no current Brand Brain yet.");
  const products = await snapshotProducts(clientId);
  const assets = await listAssets(clientId, { includeRenders: true });
  const seed = seedVisuals(cur.data, products, creative.product_id, assets);
  const inputs = completeInputs({ ...(latest?.inputs ?? {}), ...(edit.inputs ?? {}) }, seed);
  const stored = z.array(ClaimUseSchema).safeParse(latest?.ai?.claims_used);
  const claimsUsed = stored.success ? stored.data : [];
  const copy: CreativeCopy = { ...(latest?.copy ?? {}), ...(edit.copy ?? {}) };

  const isReview = creative.template_key === "review";
  const review = isReview ? reviewSource(cur.data, inputs.body ?? "") : null;
  const grounding: Grounding = checkGrounding({
    copy,
    inputs,
    claimsUsed,
    profile: cur.data,
    products,
    reviewText: review?.text ?? null,
    reviewAuthor: review?.author ?? null,
  });
  if (isReview && !review) {
    grounding.issues.push({ platform: "inputs", text: inputs.body ?? "", reason: "no review fact in the Brand Brain" });
    grounding.ok = false;
  }
  for (const l of checkCaptionLimits(copy)) {
    grounding.issues.push({ platform: l.platform, text: "", reason: l.reason, warning: true });
  }
  return { patch: { inputs, copy, note: edit.note ?? null }, grounding, claimsUsed };
}
