/**
 * campaigns/batch-email.ts — "Email this batch": who gets an email, which email, and the plan handed to the email
 * scheduler for each lead (24 Nov 2026). Pure.
 *
 * Inputs:  lead rows of one batch, the leads already emailed, saved templates, running wording tests + past winners
 * Outputs: skipReason(lead) · offerFor(lead) · makeEmailPicker(...).pick(offer, choice) · emailFor(key, …) ·
 *          buildLeadPlan(...) (the leads-row patch the scheduler sends from)
 * Used by: lib/campaigns/batch-email-plan.ts
 *
 * Operator decisions (24 Nov 2026): one batch at a time; qualified, with an email, never emailed, not unsubscribed,
 * not replied / closed, not already in a sequence; a never-checked email is checked right before its first send;
 * EU / EEA / UK leads left out unless switched on (project GDPR rule); Send email's ready-made email for the lead's
 * offer, or a saved template chosen per offer (a running wording test takes turns; the last test's winner otherwise);
 * 10 first emails a day; follow-ups OFF unless switched on. The plan is a Send-email-style plan (seq_max_step +
 * seq_copy_overrides): the scheduler sends exactly this text, plain, no screenshot, no translation.
 */
import { isNoCallCountry } from "@/lib/leads/contact-readiness";
import { resolveSegment } from "@/lib/segment";
import { defaultService, followUpSubject, serviceEmail, SERVICES, type ServiceKey } from "@/lib/email/service-templates";
import { leftoverTokens, renderTemplate, usesToken, varsForLead } from "@/lib/email/template-render";
import { armKey, nextVariant, type Variant } from "@/lib/email/wording-test";
import type { EmailUsed } from "@/lib/email/email-results";
import { isOwnEmail, type EmailReach } from "@/lib/leads/email-reach";
import { allowEmail, type TestMode } from "@/lib/test-mode-rules";

export interface BatchLead {
  id: string;
  business_name: string;
  email: string | null;
  verification_status: string | null;
  qualified: boolean | null;
  lifecycle_stage: string | null;
  stage: string | null;
  seq_status: string | null;
  country_code: string | null;
  call_segment: string | null;
  website_kind: string | null;
  has_website: boolean | null;
  needs_improvement: boolean | null;
  signal_type: string | null;
  signal_meta: Record<string, unknown> | null;
  contact_owner_name: string | null;
  category: string | null;
  demo_url: string | null;
  /** The last AI Lookup (who each email reaches), when there is one. */
  ai_profile?: EmailReach | null;
}

export type BatchSkip =
  | "not_qualified"
  | "no_email"
  | "unsubscribed"
  | "replied_or_closed"
  | "emailed_before"
  | "in_sequence"
  | "bad_address"
  | "head_office_email"
  | "eu"
  | "test_mode";

export const SKIP_TEXT: Record<BatchSkip, string> = {
  not_qualified: "Rejected by the batch filters",
  no_email: "No email address",
  unsubscribed: "Unsubscribed or asked not to be contacted",
  replied_or_closed: "Already replied, in a meeting, or closed",
  emailed_before: "Already emailed before",
  in_sequence: "Already getting emails (another sequence or campaign)",
  bad_address: "The email failed the check",
  head_office_email: "The email reaches a head office or franchise, not this business (fix it on the lead page)",
  eu: "In the EU / UK (GDPR rule; switch on to include)",
  test_mode: "Not a test contact (Test mode is on: only test contacts are emailed)",
};

const PAST_CONTACT = new Set(["replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won", "closed_lost", "dead"]);

/** Why this lead gets no email from this batch campaign, or null when it gets one. */
export function skipReason(l: BatchLead, o: { emailed: Set<string>; includeEu: boolean; testMode?: TestMode }): BatchSkip | null {
  if (l.qualified === false) return "not_qualified";
  if (!l.email) return "no_email";
  // Test mode (075): while QA tests, only the test contacts are emailed.
  if (o.testMode && !allowEmail(o.testMode, l.email)) return "test_mode";
  if (l.lifecycle_stage === "unsubscribed" || l.lifecycle_stage === "dnc") return "unsubscribed";
  if (l.stage && PAST_CONTACT.has(l.stage)) return "replied_or_closed";
  if (o.emailed.has(l.id)) return "emailed_before";
  if (l.seq_status === "active" || l.seq_status === "paused") return "in_sequence";
  if (l.verification_status === "invalid") return "bad_address";
  // A local business whose main email AI Lookup marked as a head office's / franchisor's / agency's (decision 23 Nov
  // 2026: never used as the main email by itself). Company leads (closures, exhibitors, review sites) are fine.
  if (!l.signal_type && l.ai_profile && !isOwnEmail(l.email, l.ai_profile)) return "head_office_email";
  if (!o.includeEu && isNoCallCountry((l.country_code ?? "").toLowerCase())) return "eu";
  return null;
}

/** The offer Send email would start this lead on. */
export function offerFor(l: BatchLead): ServiceKey {
  return defaultService(resolveSegment(l));
}

/** A running wording test, with how many sends each version has so far. */
export interface PickerTest {
  id: string;
  serviceKey: string;
  aKey: string;
  bKey: string;
  sentA: number;
  sentB: number;
}

/**
 * Picks the email per lead. `choice` per offer: "auto" (a running test's turn, else its last winner, else the
 * ready-made email) or a saved template the operator chose ("saved:<id>", outside any test). Taking turns continues
 * from the test's current counts.
 */
export function makeEmailPicker(o: { tests: PickerTest[]; winners: Record<string, string> }) {
  const counts = new Map(o.tests.map((t) => [t.id, { a: t.sentA, b: t.sentB }]));
  return {
    pick(offer: string, choice: string): { key: string; test: { id: string; variant: Variant } | null } {
      if (choice !== "auto") return { key: choice, test: null };
      const t = o.tests.find((x) => x.serviceKey === offer);
      if (t) {
        const c = counts.get(t.id)!;
        const variant = nextVariant(c.a, c.b);
        if (variant === "A") c.a++;
        else c.b++;
        return { key: armKey({ a_key: t.aKey, b_key: t.bKey }, variant), test: { id: t.id, variant } };
      }
      return { key: o.winners[offer] ?? `service:${offer}`, test: null };
    },
  };
}

export interface SavedTpl {
  id: string;
  name: string;
  version: number;
  service_key: string | null;
  subject: string;
  body: string;
  follow_up_1: string;
  follow_up_2: string;
  /** Migration 070: a third follow-up and each follow-up's own subject ("" = "Re: <subject>"). */
  follow_up_3?: string;
  follow_up_subject_1?: string;
  follow_up_subject_2?: string;
  follow_up_subject_3?: string;
}

export interface FilledEmail {
  key: string;
  label: string;
  subject: string;
  body: string;
  /** Up to three, each with its final subject (its own, or "Re: <subject>"). */
  followUps: { subject: string; body: string }[];
}

const PLATFORM_NAME: Record<string, string> = { trustpilot: "Trustpilot", tripadvisor: "TripAdvisor" };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function leadDetails(l: BatchLead, ctx: { city: string | null; senderName: string | null }) {
  const m = l.signal_meta ?? {};
  const platform = str(m.platform);
  return {
    businessName: l.business_name,
    ownerName: l.contact_owner_name,
    city: ctx.city,
    category: l.category,
    demoUrl: l.demo_url,
    eventName: str(m.event_name),
    booth: str(m.booth),
    platform: platform ? (PLATFORM_NAME[platform] ?? platform) : null,
    rating: num(m.rating),
    reviewCount: num(m.review_count),
    senderName: ctx.senderName,
  };
}

/**
 * The email for this lead, filled in. A saved template that is gone, needs a detail this lead lacks (e.g. the demo
 * link) or keeps an unfilled {{placeholder}} falls back to the offer's ready-made email, so nothing half-done is sent.
 */
export function emailFor(
  key: string,
  offer: ServiceKey,
  l: BatchLead,
  ctx: { city: string | null; senderName: string | null },
  saved: SavedTpl[],
): FilledEmail {
  const d = leadDetails(l, ctx);
  if (key.startsWith("saved:")) {
    const t = saved.find((x) => `saved:${x.id}` === key);
    if (t) {
      const v = varsForLead(d);
      const fu = [
        { subject: t.follow_up_subject_1 ?? "", body: t.follow_up_1 },
        { subject: t.follow_up_subject_2 ?? "", body: t.follow_up_2 },
        { subject: t.follow_up_subject_3 ?? "", body: t.follow_up_3 ?? "" },
      ];
      const parts = [t.subject, t.body, ...fu.flatMap((f) => [f.subject, f.body])];
      if (!(usesToken(parts, "demo_link") && !v.demo_link)) {
        const subject = renderTemplate(t.subject, v);
        const out = {
          subject,
          body: renderTemplate(t.body, v),
          followUps: fu.map((f) => ({ subject: followUpSubject(renderTemplate(f.subject, v), subject), body: renderTemplate(f.body, v) })),
        };
        const texts = [out.subject, out.body, ...out.followUps.flatMap((f) => [f.subject, f.body])];
        if (!leftoverTokens(texts).length && out.subject.trim() && out.body.trim()) {
          return { key, label: `${t.name} (v${t.version})`, ...out };
        }
      }
    }
  }
  const e = serviceEmail(offer, d);
  return {
    key: `service:${offer}`,
    label: SERVICES.find((s) => s.key === offer)?.label ?? offer,
    subject: e.subject,
    body: e.body,
    followUps: e.followUps.map((body) => ({ subject: followUpSubject("", e.subject), body })),
  };
}

/** One step of the plan the scheduler sends from (extra keys label the send; see sequence-scheduler planStepMeta). */
export interface PlanStep {
  subject: string;
  body: string;
  campaign_id?: string;
  daily_limit?: number;
  used?: EmailUsed;
}

/** The leads-row patch that hands this lead's emails to the scheduler (first email at `sendAt`, from `sender`). */
export function buildLeadPlan(o: {
  email: FilledEmail;
  test: { id: string; variant: Variant } | null;
  followUps: 0 | 1 | 2 | 3;
  campaignId: string;
  dailyLimit: number;
  sender: string;
  sendAt: string;
}): {
  seq_status: "active";
  seq_step: 0;
  seq_next_step_at: string;
  seq_sender_email: string;
  seq_max_step: number;
  seq_copy_overrides: Record<string, PlanStep>;
} {
  const used: EmailUsed = {
    key: o.email.key,
    label: o.email.label,
    edited: false,
    ...(o.test ? { test_id: o.test.id, variant: o.test.variant } : {}),
  };
  const steps: Record<string, PlanStep> = {
    "1": { subject: o.email.subject, body: o.email.body, campaign_id: o.campaignId, daily_limit: o.dailyLimit, used },
  };
  // A saved template with fewer follow-ups than asked sends the ones it has (empty ones are skipped).
  o.email.followUps
    .slice(0, o.followUps)
    .filter((f) => f.body.trim())
    .forEach((f, i) => {
      steps[String(i + 2)] = { subject: f.subject, body: f.body, campaign_id: o.campaignId };
    });
  return {
    seq_status: "active",
    seq_step: 0,
    seq_next_step_at: o.sendAt,
    seq_sender_email: o.sender,
    seq_max_step: 1 + Object.keys(steps).length - 1,
    seq_copy_overrides: steps,
  };
}

/** How many different days (in the batch's time zone) the planned first emails fall on. Pure. */
export function sendingDays(times: string[], tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return new Set(times.map((t) => fmt.format(new Date(t)))).size;
}

/** The mailboxes an offer sends from: reputation emails from OptiRate (as Send email does), the rest from all. */
export function poolFor<T extends { email: string }>(offer: ServiceKey, boxes: T[]): T[] {
  if (offer !== "reputation_mgmt") return boxes;
  const optirate = boxes.filter((b) => (b.email.split("@")[1] ?? "").toLowerCase().includes("optirate"));
  return optirate.length ? optirate : boxes;
}

