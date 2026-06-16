/**
 * api/leads/[id]/outreach/route.ts — DEPRECATED (retired Instantly.ai send).
 *
 * Email outreach now runs through the screenshot-first sequence
 * (POST /api/leads/:id/sequence {action:"enroll"} + sequence-scheduler), and a
 * one-off send through POST /api/leads/:id/email. This endpoint is kept as a
 * tombstone that returns 410 so any stale caller fails loudly instead of
 * silently misfiring to Instantly with a placeholder campaign id.
 */

import { withApi } from "@/lib/api-wrap";
import { fail } from "@/lib/response";

export const POST = withApi(async (_req, { params }) => {
  return fail(
    `Retired endpoint. Use POST /api/leads/${params.id}/sequence (enroll) or /email instead.`,
    410,
  );
});
