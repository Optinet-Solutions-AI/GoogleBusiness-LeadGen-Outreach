/**
 * email/load-email-preview.ts — everything the Send email preview shows before anything is sent.
 *
 * Inputs:  lead id; the lead row, its active campaign (sender pool, window, copy style/overrides), the mailboxes
 * Outputs: EmailPreview — to/from, when it goes out, the pitch, the language, every step's exact wording, and
 *          whether it can be sent (with the plain reason when not). Places no paid call, sends nothing.
 * Used by: app/api/leads/[id]/sequence/preview/route.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import {
  DEFAULT_WINDOW,
  SEQ_COLS,
  enrollRefusal,
  loadLeadEmailCampaign,
  type SeqLeadRow,
} from "@/lib/pipeline/sequence-scheduler";
import { buildCampaignConfig } from "@/lib/campaigns/lead-campaign-config";
import { isWithinWindow, nextSlot } from "@/lib/campaigns/send-window";
import { campaignTimezone } from "@/lib/call-hours";
import { resolveSegment } from "@/lib/segment";
import { asSeqStyle, usesNoDemoCopy, variantFor, SEQ_STYLES, type SeqVariant } from "@/lib/email/sequence-templates";
import { allSteps, type StepCopy } from "@/lib/email/sequence-preview";
import { enrollRefusalText } from "@/lib/email/enroll-messages";
import { needsCheck } from "@/lib/email/enroll-lead";
import { verificationActive } from "@/lib/services/email-validator";
import { resolveLanguageCode, languageName } from "@/lib/services/gemini";
import { EMAIL_STATE_LABEL, emailState, type EmailState } from "@/lib/leads/contact-readiness";
import { localTimeText, windowText } from "@/lib/outreach/when-text";

export interface EmailPreview {
  leadId: string;
  businessName: string;
  to: string | null;
  emailState: { state: EmailState; label: string; tone: "positive" | "warning" | "urgent" | "muted"; hint: string };
  canSend: boolean;
  /** Plain sentence when it can't be sent. */
  block: string | null;
  /** The address was never checked: the Send button checks it first (under 1 cent). */
  willVerifyFirst: boolean;
  from: { pinned: string | null; pool: string[] };
  /** "Goes out within about 15 minutes." / "Outside sending hours now — goes out around …". */
  timing: string;
  window: string;
  campaign: string | null;
  style: string;
  pitch: string;
  variant: SeqVariant;
  /** No demo built yet: the 2-step "want a free sample?" version goes out (build/improve only). */
  noDemo: boolean;
  language: { code: string; name: string | null };
  demoUrl: string | null;
  screenshotUrl: string | null;
  steps: { step: number; day: number; copy: StepCopy }[];
}

const PITCH: Record<SeqVariant, string> = {
  build: "No website: we built them a demo site. 4 emails, the screenshot on day 4 and the live link on day 8.",
  improve: "Weak website: we built them a modern demo. 4 emails, the screenshot on day 4 and the live link on day 8.",
  services: "Good website already: we offer AI services (booking, receptionist, chat), no demo. 2 emails.",
};
const PITCH_NO_DEMO: Record<"build" | "improve", string> = {
  build:
    "No website, no demo built yet: we offer to make them a free sample site. 2 emails, no screenshot or link. Build the demo first if you want the 4-email version with the screenshot and live link.",
  improve:
    "Weak website, no demo built yet: we offer to make them a free modern version. 2 emails, no screenshot or link. Build the demo first if you want the 4-email version with the screenshot and live link.",
};

export async function loadEmailPreview(leadId: string): Promise<EmailPreview | null> {
  const db = getDb();
  const { data } = await db.from("leads").select(SEQ_COLS).eq("id", leadId).maybeSingle();
  if (!data) return null;
  const lead = data as unknown as SeqLeadRow;

  const [campaign, mailboxes, refusal] = await Promise.all([
    loadLeadEmailCampaign(leadId, db),
    db.from("email_accounts").select("email").eq("status", "active"),
    enrollRefusal(lead, { allowNoDemo: true }),
  ]);
  const allMailboxes = ((mailboxes.data ?? []) as { email: string }[]).map((r) => r.email);
  const cfg = buildCampaignConfig({
    campaign,
    leadCountryCode: lead.country_code,
    tzFor: campaignTimezone,
    allMailboxes,
    defaultWindow: DEFAULT_WINDOW,
  });

  const segment = resolveSegment(lead);
  const variant = variantFor(segment);
  const noDemo = usesNoDemoCopy(variant, !lead.demo_url);
  const style = asSeqStyle(campaign?.copy_style);
  // Campaign wording is written for the demo version, so a no-demo lead gets ours (same rule as the tick).
  const steps = allSteps({ ...lead, call_segment: segment, no_demo: noDemo }, style, noDemo ? null : campaign?.copy_overrides ?? null);

  let block = refusal ? enrollRefusalText(refusal) : null;
  if (!block && cfg.senderPool.length === 0) block = "No sending mailbox is connected. Connect one on the Email page first.";

  const now = new Date();
  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  let timing: string;
  if (pausedUntil && Date.parse(pausedUntil) > now.getTime()) {
    timing = `All email sending is paused until ${new Date(pausedUntil).toUTCString()}. It goes out after that.`;
  } else if (isWithinWindow(now, cfg.window)) {
    timing = "Goes out within about 15 minutes (sends are spaced out so they look human).";
  } else {
    const at = nextSlot({ after: now, window: cfg.window, seed: `${leadId}:1` });
    timing = `Outside sending hours right now. Goes out around ${localTimeText(at, cfg.window.tz)} their time.`;
  }

  const langCode = resolveLanguageCode(lead.language_code, lead.country_code);
  const st = emailState({ email: lead.email, verification_status: lead.verification_status });
  return {
    leadId,
    businessName: lead.business_name,
    to: lead.email,
    emailState: { state: st, ...EMAIL_STATE_LABEL[st] },
    canSend: !block,
    block,
    willVerifyFirst: Boolean(lead.email) && verificationActive() && needsCheck(lead.verification_status),
    from: { pinned: lead.seq_sender_email, pool: lead.seq_sender_email ? [lead.seq_sender_email] : cfg.senderPool },
    timing,
    window: windowText(cfg.window),
    campaign: campaign?.name ?? null,
    style: SEQ_STYLES.find((s) => s.value === style)?.label ?? style,
    pitch: noDemo ? PITCH_NO_DEMO[variant as "build" | "improve"] : PITCH[variant],
    variant,
    noDemo,
    language: { code: langCode, name: languageName(langCode) },
    demoUrl: lead.demo_url,
    screenshotUrl: lead.screenshot_url,
    steps,
  };
}
