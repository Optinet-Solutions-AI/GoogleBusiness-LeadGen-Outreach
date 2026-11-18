/**
 * api/webhooks/ongage/route.ts — receives Ongage's bounce / unsubscribe / complaint reports (every 10 minutes).
 *
 * Inputs:  POST ?token=<ONGAGE_WEBHOOK_SECRET>, body = JSON array of { email, list_id, status, esp_name }
 * Outputs: { success, data: { received, applied, ignored } } — 401 on a wrong token, 503 while no secret is set
 * Used by: Ongage → Settings → Configurations → "Webhook endpoint URL" (account-wide; see
 *          workflows/run_email_sequence.md). Ongage sends no signature, so the unguessable token is the guard.
 */
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config";
import { applyOngageEvents, parseOngagePayload } from "@/lib/email/ongage-events";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("webhook.ongage");

function tokenMatches(given: string | null): boolean {
  const want = env.ONGAGE_WEBHOOK_SECRET;
  if (!given || !want) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!env.ONGAGE_WEBHOOK_SECRET) return fail("Ongage webhook is not switched on (ONGAGE_WEBHOOK_SECRET is empty).", 503);
  if (!tokenMatches(new URL(req.url).searchParams.get("token"))) return fail("unauthorized", 401);

  // Ongage's own docs show slightly malformed JSON, so read text first and fail soft.
  const text = await req.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    log.warn({ bytes: text.length }, "ongage.webhook.unparseable");
    return fail("body is not valid JSON", 400);
  }
  const summary = await applyOngageEvents(parseOngagePayload(body));
  return ok(summary);
}
