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

const log = getLogger("stage-5-email");

export interface EmailLead {
  id: string;
  business_name: string;
  email: string | null;
  demo_url?: string | null;
  primary_offer?: string | null;
  lifecycle_stage?: string | null;
  phone?: string | null;
}

export interface EmailResult {
  sent: boolean;
  skipped?: "no_email" | "suppressed";
  noop?: boolean;
}

export async function run(lead: EmailLead): Promise<EmailResult> {
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

  const firstName = (lead.business_name.split(/\s+/)[0] || "there").trim();
  const { subject, html } = composeEmail(lead, firstName);

  const result = await sendOutreachEmail({ to: lead.email, subject, html });

  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "email_sent",
    meta: { noop: result.noop, message_id: result.messageId, offer: lead.primary_offer ?? null },
  });
  await db.from("leads").update({ stage: "outreached" }).eq("id", lead.id);

  log.info({ lead_id: lead.id, noop: result.noop }, "stage_5_email.done");
  return { sent: result.sent, noop: result.noop };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A short, plain cold email. (Templated for MVP — can move to Gemini-written copy later.) */
function composeEmail(lead: EmailLead, firstName: string): { subject: string; html: string } {
  const name = esc(lead.business_name);
  const subject = `Quick idea for ${lead.business_name}`;
  const demoLine = lead.demo_url
    ? `<p>I actually put a quick sample together so you can see what I mean: <a href="${esc(lead.demo_url)}">${esc(lead.demo_url)}</a> — no cost, no commitment.</p>`
    : `<p>I help local businesses like yours get more out of their website — and I'm happy to put a quick sample together if you're open to it.</p>`;
  const html = `<p>Hi ${esc(firstName)},</p>
<p>I'm Sam from Optirate — I came across ${name} online and had a quick thought about your website.</p>
${demoLine}
<p>Worth a look?</p>
<p>— Sam</p>`;
  return { subject, html };
}
