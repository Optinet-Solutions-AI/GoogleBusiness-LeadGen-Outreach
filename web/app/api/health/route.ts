/**
 * api/health/route.ts — Liveness check. No auth, no DB.
 *
 * GET /api/health → { success: true, data: { status: 'ok' } }
 */

import { ok } from "@/lib/response";

export async function GET() {
  return ok({ status: "ok" });
}
