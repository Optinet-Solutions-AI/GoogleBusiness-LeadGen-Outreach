/**
 * stage-5-email.ts — EMAIL channel: send a cold outreach email to a has-website lead.
 *
 * Inputs:  a lead ({ id, business_name, email, demo_url?, lifecycle_stage?, phone? })
 * Outputs: an outreach_events row + leads.stage; returns a result (never throws into the caller)
 * Used by: app/api/leads/[id]/email/route.ts (operator "Send email" action)
 *
 * The email channel for has-website leads (they have a real site → an email to crawl). No-website
 * leads go to DM/SMS instead. Guards: requires an email (else → needs_email) and isn't suppressed
 * (DNC/STOP/unsubscribed). Runs at $0 — sends soft-no-op until a mailbox is connected.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import { isSuppressed } from "../suppression";
import { sendOutreachEmail } from "../services/email-sender";
import { resolveSpintax } from "../services/spintax";
import { sendDecision } from "../verify/gate";
import { verificationActive } from "../services/email-validator";
import type { VerifyStatus } from "../services/email-validator/types";

const log = getLogger("stage-5-email");

export interface EmailLead {
  id: string;
  business_name: string;
  email: string | null;
  demo_url?: string | null;
  primary_offer?: string | null;
  /** Used by the buy-inventory email to name the closing location ("Austin, TX"). */
  address?: string | null;
  lifecycle_stage?: string | null;
  phone?: string | null;
  verification_status?: VerifyStatus | null;
}

export interface EmailResult {
  sent: boolean;
  skipped?: "no_email" | "suppressed" | "already_sent" | "paused" | "capped" | "unverified";
  noop?: boolean;
}

export async function run(
  lead: EmailLead,
  opts?: { senderEmail?: string | null },
): Promise<EmailResult> {
  const db = getDb();

  if (!lead.email) {
    await db.from("leads").update({ stage: "needs_email" }).eq("id", lead.id);
    log.info({ lead_id: lead.id }, "stage_5_email.skip_no_email");
    return { sent: false, skipped: "no_email" };
  }
  if (await isSuppressed(lead, "email")) {
    log.info({ lead_id: lead.id }, "stage_5_email.suppressed");
    return { sent: false, skipped: "suppressed" };
  }

  // Idempotency — cold outreach sends ONE initial email per lead. If we've
  // already recorded an outbound message, don't send again. (Fail open if the
  // email_messages table isn't there yet — the row insert below is the backstop.)
  const { data: priorSends } = await db
    .from("email_messages")
    .select("id")
    .eq("lead_id", lead.id)
    .eq("direction", "outbound")
    .limit(1);
  if (priorSends && priorSends.length > 0) {
    log.info({ lead_id: lead.id }, "stage_5_email.skip_already_sent");
    return { sent: false, skipped: "already_sent" };
  }

  const decision = sendDecision(lead.verification_status ?? null, verificationActive());
  if (decision !== "send") {
    log.info({ lead_id: lead.id, decision }, "stage_5_email.gated");
    return { sent: false, skipped: "unverified" };
  }

  const { subject, html } = renderOutreachEmail(lead);

  const result = await sendOutreachEmail({
    to: lead.email,
    subject,
    html,
    senderEmail: opts?.senderEmail,
  });

  // Held back by the kill switch or the daily cap — don't advance the lead.
  if (result.reason === "paused" || result.reason === "capped") {
    log.info({ lead_id: lead.id, reason: result.reason }, "stage_5_email.held");
    return { sent: false, skipped: result.reason };
  }

  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "email_sent",
    meta: { noop: result.noop, message_id: result.messageId, offer: lead.primary_offer ?? null },
  });

  // Record the sent email as a thread message so the Inbox shows our side of
  // the conversation (the reply-reader stores inbound rows the same way).
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  await db.from("email_messages").insert({
    lead_id: lead.id,
    direction: "outbound",
    message_id: result.messageId,
    to_addr: lead.email,
    subject,
    body_text: bodyText,
    body_snippet: bodyText.slice(0, 200),
    status: result.sent ? "sent" : "failed",
  });

  await db.from("leads").update({ stage: "outreached" }).eq("id", lead.id);

  log.info({ lead_id: lead.id, noop: result.noop }, "stage_5_email.done");
  return { sent: result.sent, noop: result.noop };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render the outreach email for a lead (subject + html). Exported so the
 * campaign test-send can preview/send the exact same message a real send would.
 */
export function renderOutreachEmail(lead: EmailLead): { subject: string; html: string } {
  const firstName = (lead.business_name.split(/\s+/)[0] || "there").trim();
  return composeEmail(lead, firstName);
}

/**
 * A short, plain cold email with {spintax|variants} so every recipient gets a
 * slightly different message (identical bodies across recipients are a spam
 * signal — email-sending-system.md §7.2). Resolved once per send.
 */
function composeEmail(lead: EmailLead, firstName: string): { subject: string; html: string } {
  if (lead.primary_offer === "buy_inventory") return composeBuyInventoryEmail(lead);
  const name = esc(lead.business_name);
  const subject = resolveSpintax(`{Quick idea for|A quick thought on|An idea for} ${lead.business_name}`);
  const demoLine = lead.demo_url
    ? `<p>{I actually put a quick sample together|I went ahead and mocked up a sample|I put together a quick sample} so you can see what I mean: <a href="${esc(lead.demo_url)}">${esc(lead.demo_url)}</a> — no cost, no commitment.</p>`
    : `<p>{I help local businesses like yours|I work with local businesses like yours} get more out of their website{ — and I'm happy to put together a quick sample if you're open to it.| — happy to mock one up if you're open to it.}</p>`;
  const html = resolveSpintax(`<p>{Hi|Hey|Hello} ${esc(firstName)},</p>
<p>I'm Sam from RateUp — {I came across|I found|I spotted} ${name} online and had a quick thought about your website.</p>
${demoLine}
<p>{Worth a look?|Open to a quick look?|Mind if I send it over?}</p>
<p>— Sam</p>`);
  return { subject, html };
}

/**
 * Liquidation lead (WARN closure notice): plain, short, no links or images. Offers to buy
 * the remaining inventory of the closing location and asks one question.
 */
export function composeBuyInventoryEmail(lead: EmailLead): { subject: string; html: string } {
  const name = esc(lead.business_name);
  const place = esc(lead.address?.trim() || "your location");
  const subject = resolveSpintax(`{Remaining inventory at|Your inventory at|Inventory question for} ${lead.business_name}`);
  const html = resolveSpintax(`<p>{Hi|Hello} there,</p>
<p>I saw that ${name} {has filed a notice for|is planning changes at} ${place}. We buy remaining and surplus inventory from businesses that are closing or consolidating — stock, fixtures and equipment — and we can move quickly{ and handle pickup| with our own pickup}.</p>
<p>{Is there inventory there you still need to clear?|Do you have stock there you still need to move?}</p>
<p>— Sam</p>
<p style="color:#888;font-size:12px">Not the right person, or not interested? Just reply "no" and I won&#39;t email again.</p>`);
  return { subject, html };
}
