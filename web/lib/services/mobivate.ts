/**
 * mobivate.ts — Send SMS via Mobivate (the "text a one-time link" step of the journey).
 *
 * Inputs:  { to (E.164), body, from?, reference? }
 * Outputs: { providerMsgId, status, noop } — never throws; failures return status 'failed'
 * Used by: lib/pipeline/stage-6-sms.ts
 *
 * SOFT NO-OP: with MOBIVATE_API_KEY blank, this does NOT call out — it logs and returns a fake id
 * with status 'sent' (mirrors brandfetch/scrapingbee). That lets the whole connected journey run
 * end-to-end at $0 (link + form + inbox are real) before any SMS spend or live key.
 *
 * NOTE: confirm the exact host/path + body shape against wiki.mobivatebulksms.com before going live
 * with a real key — only the request wiring below needs updating; the soft-no-op + callers don't.
 */

import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("mobivate");
// Production API host is account-specific — Mobivate provides it on request.
// Set MOBIVATE_API_BASE (e.g. https://<your-host>); the endpoint is <base>/send/single.

export interface SendSmsInput {
  to: string;
  body: string;
  from?: string;
  reference?: string;
}

export interface SendSmsResult {
  providerMsgId: string | null;
  status: "sent" | "failed";
  noop: boolean;
}

export function isMobivateConfigured(): boolean {
  return Boolean(env.MOBIVATE_API_KEY && env.MOBIVATE_API_BASE);
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const from = input.from || env.MOBIVATE_SENDER_ID || "Optirate";

  // Soft no-op: prove the journey at $0 without a key/host (and without texting anyone).
  if (!env.MOBIVATE_API_KEY || !env.MOBIVATE_API_BASE) {
    const fakeId = `noop:${input.reference ?? to10(input.to)}`;
    log.info({ to: input.to, from, noop: true }, "mobivate.sendSms.noop (no api key)");
    return { providerMsgId: fakeId, status: "sent", noop: true };
  }

  try {
    const resp = await retry(
      () =>
        fetch(`${env.MOBIVATE_API_BASE.replace(/\/$/, "")}/send/single`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.MOBIVATE_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            text: input.body,
            originator: from,
            recipient: input.to,
            ...(input.reference ? { reference: input.reference } : {}),
          }),
        }),
      { maxAttempts: 3 },
    );

    if (!resp.ok) {
      log.warn({ to: input.to, status: resp.status }, "mobivate.sendSms.bad_status");
      return { providerMsgId: null, status: "failed", noop: false };
    }

    const data = (await resp.json().catch(() => ({}))) as { success?: boolean; record?: { id?: string } };
    if (!data.success) {
      log.warn({ to: input.to }, "mobivate.sendSms.not_success");
      return { providerMsgId: null, status: "failed", noop: false };
    }
    const providerMsgId = data.record?.id ?? null;
    log.info({ to: input.to, providerMsgId }, "mobivate.sendSms.ok");
    return { providerMsgId, status: "sent", noop: false };
  } catch (err) {
    log.warn({ to: input.to, err: String(err) }, "mobivate.sendSms.error");
    return { providerMsgId: null, status: "failed", noop: false };
  }
}

/** last 10 digits — only used to label a no-op fake id, never sent anywhere */
function to10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10) || "unknown";
}
