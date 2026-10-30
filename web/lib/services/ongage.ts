/**
 * ongage.ts — Send one outreach email through Ongage's transactional API (our HTML, our sender address).
 *
 * Inputs:  recipient, subject, html, optional hosted screenshot URL, sender { email, fromName }
 * Outputs: { success, messageId } or { success: false, error } — never throws into the caller
 * Used by: lib/services/email-sender.ts (mailboxes whose email_provider = 'ongage')
 *
 * POST <base>[/<list_id>]/api/transactional/send_embed_content with the `x-api-key` header
 * (Ongage "Transactional Mailing API Methods"). From and Reply-To are the mailbox address, so
 * replies still land in that mailbox and the IMAP sync picks them up as before.
 *
 * Differences from SMTP: Ongage takes no attachments, so the screenshot is linked by its hosted
 * URL instead of inlined; and it sets no threading headers. The leads are not Ongage contacts, so
 * `check_status` is left off; `check_global_and_list_suppression` still blocks suppressed addresses.
 * A 429 is retried (not sent yet); a 5xx is not, because the email may already have gone out.
 */

import "@/lib/server-guard";
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";
import { htmlToText, newMessageId, placeScreenshot } from "./email-body";

const log = getLogger("ongage");

export interface OngageSender {
  email: string;
  fromName?: string | null;
}

class RateLimited extends Error {}

export function isOngageConfigured(): boolean {
  return Boolean(env.ONGAGE_API_KEY) && /^\d+$/.test(env.ONGAGE_TRANSACTIONAL_CAMPAIGN_ID);
}

export async function sendEmailOngage(
  to: string,
  subject: string,
  html: string,
  options: { screenshotUrl?: string },
  sender: OngageSender,
): Promise<{ success: true; messageId: string } | { success: false; error: string }> {
  if (!isOngageConfigured()) {
    log.warn({ to }, "ongage.not_configured");
    return { success: false, error: "Ongage is not configured (ONGAGE_API_KEY, ONGAGE_TRANSACTIONAL_CAMPAIGN_ID)." };
  }

  const bodyHtml = options.screenshotUrl
    ? placeScreenshot(
        html,
        `<img src="${options.screenshotUrl.replace(/"/g, "%22")}" alt="Website preview" ` +
          `style="max-width:100%;border-radius:8px;border:1px solid #e4e7f0">`,
      )
    : html;

  const base = env.ONGAGE_API_BASE.replace(/\/$/, "");
  const url = `${base}${env.ONGAGE_LIST_ID ? `/${env.ONGAGE_LIST_ID}` : ""}/api/transactional/send_embed_content`;
  const payload = {
    campaign_id: Number(env.ONGAGE_TRANSACTIONAL_CAMPAIGN_ID),
    recipients: [to],
    ...(env.ONGAGE_SENDING_CONNECTION_ID ? { sending_connection_id: Number(env.ONGAGE_SENDING_CONNECTION_ID) } : {}),
    check_global_and_list_suppression: true,
    message: {
      subject,
      content_html: bodyHtml,
      content_text: htmlToText(html),
      addresses: {
        from_name: sender.fromName || sender.email,
        from_address: sender.email,
        reply_address: sender.email,
      },
    },
  };

  try {
    const res = await retry(
      async () => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "x-api-key": env.ONGAGE_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.status === 429) throw new RateLimited("Ongage rate limit (429)");
        return r;
      },
      { maxAttempts: 3, retryOn: (e) => e instanceof RateLimited },
    );

    const data = (await res.json().catch(() => null)) as {
      metadata?: { error?: boolean };
      payload?: { message?: string };
    } | null;
    if (!res.ok || !data || data.metadata?.error) {
      const error = `Ongage ${res.status}: ${data?.payload?.message ?? "unexpected response"}`;
      log.error({ to, status: res.status, err: error }, "ongage.send_failed");
      return { success: false, error };
    }

    const messageId = newMessageId(sender.email);
    // The send response shape is undocumented: keep a short copy for diagnosis.
    log.info({ to, messageId, payload: JSON.stringify(data.payload ?? null).slice(0, 300) }, "ongage.sent");
    return { success: true, messageId };
  } catch (e) {
    const error = (e as Error).message;
    log.error({ to, err: error }, "ongage.send_failed");
    return { success: false, error };
  }
}
