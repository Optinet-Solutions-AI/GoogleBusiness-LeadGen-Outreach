/**
 * api/leads/[id]/build/route.ts — Operator clicks "Build website" on a lead.
 *
 * POST /api/leads/:id/build
 *   - Runs stages 2 → 3 → 4 (enrich, generate, deploy) for THIS lead only.
 *   - Long-running (~30–60s). Fire-and-forget; client polls /api/leads/:id
 *     for stage='deployed' to know when it's done.
 *   - Per-lead manual trigger; we never auto-build a whole batch.
 */

import { buildLead } from "@/lib/pipeline/build-lead";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.leads.build");

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // Fire-and-forget; the operator polls the lead row for stage='deployed'.
  buildLead(params.id).catch((err) =>
    log.error({ lead_id: params.id, err: String(err) }, "build.failed"),
  );
  return ok({ id: params.id, status: "building" }, { status: 202 });
}
