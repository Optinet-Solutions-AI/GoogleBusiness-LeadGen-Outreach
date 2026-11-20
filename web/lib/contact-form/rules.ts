/**
 * contact-form/rules.ts — the plain rules for sending a lead's website contact form. Pure.
 *
 * Inputs:  a lead's website / contact page, a contact_form_runs row, the clock, a mailbox's name + address
 * Outputs: which host counts as "their own site", whether a run is still busy / stale / reusable, the name we type
 *          into the form, and a plain sentence for each run status
 * Used by: lib/contact-form/runs.ts, lib/services/contact-form-browser.ts, components/outreach/ContactFormModal.tsx
 *
 * "Their own site" is only ever a real website (lib/filters.ts hasRealWebsite): a Facebook / Yelp / Linktree page as the
 * website or contact page never counts, so we never search or submit on someone else's platform.
 * A send stuck for 10+ minutes may already have gone out, so it becomes "unknown" (check their page), never
 * "failed" — a retry could send the same message twice.
 */

import { hasRealWebsite } from "@/lib/filters";

export type RunStatus = "looking" | "ready" | "no_form" | "sending" | "sent" | "blocked" | "failed" | "unknown";

export interface FormRun {
  id: string;
  lead_id: string;
  status: RunStatus;
  contact_url: string | null;
  form_shot_url: string | null;
  filled_shot_url: string | null;
  result_shot_url: string | null;
  sender_email: string | null;
  sender_name: string | null;
  subject: string | null;
  message: string | null;
  offer_key: string | null;
  fields: { name: string; value: string }[] | null;
  reason: string | null;
  usd: number | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

const STALE_MS = 10 * 60_000;
const REUSE_MS = 24 * 60 * 60_000;

/** The name typed into their form: the mailbox's display name, else "grace@…" → "Grace". */
export function senderName(fromName: string | null | undefined, email: string): string {
  const name = (fromName ?? "").trim();
  if (name) return name;
  const local = email.split("@")[0] ?? "";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const realHost = (url: string | null | undefined) => (url && hasRealWebsite(url) ? hostOf(url) : null);

/** Their own site's host: the website's, else the contact page's (www. ignored, lower-case). Real websites only. */
export function leadHost(lead: { website_url: string | null; contact_page_url: string | null }): string | null {
  return realHost(lead.website_url) ?? realHost(lead.contact_page_url);
}

/** Is this URL on that host (www. ignored)? */
export function sameSite(url: string, host: string): boolean {
  const h = hostOf(url);
  return !!h && h === host.toLowerCase().replace(/^www\./, "");
}

/** The saved contact page, only when it's on their own site (never Facebook, a directory, …). */
export function ownContactUrl(lead: { website_url: string | null; contact_page_url: string | null }): string | null {
  const host = leadHost(lead);
  return host && lead.contact_page_url && sameSite(lead.contact_page_url, host) ? lead.contact_page_url : null;
}

/** The status to show / act on: a look stuck 10+ min failed; a send stuck 10+ min may have gone out (unknown). */
export function effectiveStatus(run: FormRun, now: number = Date.now()): RunStatus {
  const age = now - Date.parse(run.updated_at);
  if (run.status === "looking" && age > STALE_MS) return "failed";
  if (run.status === "sending" && age > STALE_MS) return "unknown";
  return run.status;
}

export function isActive(run: FormRun, now: number = Date.now()): boolean {
  const s = effectiveStatus(run, now);
  return s === "looking" || s === "sending";
}

/** A ready look from the last 24 h can be sent from without opening their page again. */
export function canReuseLook(run: FormRun, now: number = Date.now()): boolean {
  return effectiveStatus(run, now) === "ready" && now - Date.parse(run.created_at) < REUSE_MS;
}

export const STATUS_TEXT: Record<RunStatus, string> = {
  looking: "Opening their contact page…",
  ready: "This is their contact form. Write your message and send it.",
  no_form: "We couldn't find a contact form on their website.",
  sending: "Filling in their form and sending it…",
  sent: "Sent. Their page confirmed the message went through.",
  blocked: "Not sent: the form couldn't be filled honestly or is protected (CAPTCHA). Nothing was sent.",
  failed: "Not sent.",
  unknown: "We may have sent it but couldn't confirm. Check their page before trying again.",
};
