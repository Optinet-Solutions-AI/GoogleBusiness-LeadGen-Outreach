/**
 * api/webhooks/stripe/route.ts — Inbound Stripe events (subscriptions, payments).
 *
 * POST /api/webhooks/stripe
 *   - Stub for now. Wire signature verification + handler when billing goes live.
 */

import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/response";

const log = getLogger("webhook.stripe");

export async function POST(req: Request) {
  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  log.info({ type: payload.type }, "received");
  return ok({ received: true });
}
