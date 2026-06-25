/**
 * build-gate.ts — Website-builder niche gate (shared by the build/improve/
 * regenerate routes).
 *
 * Inputs:  leadId
 * Outputs: null when the lead's niche IS one of the 5 focus niches (caller
 *          proceeds); otherwise records an explanatory last_error and returns
 *          the reason so the route can respond `status:"skipped"`.
 * Used by: app/api/leads/[id]/{build,improve,regenerate}/route.ts
 *
 * Why centralized: the operator restricted the website builder to five niches
 * (Trades, Dental, Chiropractic, Restaurants, Auto). Each long-running build
 * entrypoint must enforce that identically and bail out BEFORE spinning up a
 * Cloud Run job. Off-list leads stay scraped/enriched and remain usable for
 * email/SMS outreach. See memory project_niche_html_templates.
 */

import "server-only";
import { getDb } from "../db";
import { resolveBuildTemplate, SUPPORTED_BUILD_NICHES_LABEL } from "../data/niches";

export async function skipIfNotBuildable(
  leadId: string,
): Promise<{ reason: string; templateSlug: string | null } | null> {
  const db = getDb();
  const { data: lead } = await db
    .from("leads")
    .select("batch_id, category")
    .eq("id", leadId)
    .single<{ batch_id: string; category: string | null }>();
  const { data: batch } = lead
    ? await db
        .from("batches")
        .select("template_slug, niche")
        .eq("id", lead.batch_id)
        .single<{ template_slug: string; niche: string | null }>()
    : { data: null };
  // Tolerate legacy / non-focus batch slugs: derive the focus template from the
  // lead's own category when the stored batch slug isn't a focus slug.
  const templateSlug = resolveBuildTemplate({
    batchTemplateSlug: batch?.template_slug ?? null,
    category: lead?.category ?? null,
    niche: batch?.niche ?? null,
  });
  if (templateSlug) return null;

  const reason = `Website builder supports only ${SUPPORTED_BUILD_NICHES_LABEL}. This lead's niche (template '${batch?.template_slug ?? "unknown"}') isn't built — it's still available for outreach.`;
  await db.from("leads").update({ last_error: reason }).eq("id", leadId);
  return { reason, templateSlug: batch?.template_slug ?? null };
}
