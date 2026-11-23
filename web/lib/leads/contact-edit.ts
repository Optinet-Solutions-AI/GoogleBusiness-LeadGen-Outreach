/**
 * leads/contact-edit.ts — turn a hand-typed phone, website or contact page into the lead fields to save.
 *
 * Inputs:  what the operator typed in the Contact card (each field optional; empty / null = remove it)
 * Outputs: contactEditPatch(input) → { ok: true, patch } | { ok: false, error } with a plain sentence
 * Used by: app/api/leads/[id]/route.ts (PATCH)
 *
 * QA 23 Nov 2026: only the email could be corrected by hand. A new website also clears the old site's check (score,
 * issues, status), because that verdict was about a different site; the lead page then says it isn't checked yet.
 * Pure.
 */
import { classifyWebsite, hasRealWebsite } from "@/lib/filters";

export interface ContactEditInput {
  phone?: string | null;
  website_url?: string | null;
  contact_page_url?: string | null;
}

export type ContactEditResult = { ok: true; patch: Record<string, unknown> } | { ok: false; error: string };

const BAD_URL = "That doesn't look like a web address.";

/** "joes.com/contact" → "https://joes.com/contact"; null when it isn't a web address. */
function webAddress(typed: string): string | null {
  if (/\s/.test(typed)) return null;
  const url = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
  try {
    const host = new URL(url).hostname;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host) ? url : null;
  } catch {
    return null;
  }
}

const CLEARED_CHECK = { website_score: null, website_issues: [], website_status: null, needs_improvement: null, audited_at: null };

export function contactEditPatch(input: ContactEditInput): ContactEditResult {
  const patch: Record<string, unknown> = {};

  if (input.phone !== undefined) {
    const typed = (input.phone ?? "").trim();
    if (!typed) patch.phone = null;
    else {
      const digits = typed.replace(/\D/g, "").length;
      if (digits < 7 || digits > 15) return { ok: false, error: "That doesn't look like a phone number." };
      patch.phone = typed;
    }
  }

  if (input.website_url !== undefined) {
    const typed = (input.website_url ?? "").trim();
    if (!typed) Object.assign(patch, { website_url: null, website_kind: "none", has_website: false, ...CLEARED_CHECK });
    else {
      const url = webAddress(typed);
      if (!url) return { ok: false, error: BAD_URL };
      Object.assign(patch, { website_url: url, website_kind: classifyWebsite(url), has_website: hasRealWebsite(url), ...CLEARED_CHECK });
    }
  }

  if (input.contact_page_url !== undefined) {
    const typed = (input.contact_page_url ?? "").trim();
    if (!typed) patch.contact_page_url = null;
    else {
      const url = webAddress(typed);
      if (!url) return { ok: false, error: BAD_URL };
      patch.contact_page_url = url;
    }
  }

  return { ok: true, patch };
}
