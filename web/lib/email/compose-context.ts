/**
 * email/compose-context.ts — everything the Send email window needs about one lead, in one read.
 *
 * Inputs:  lead id; the lead row, its batch's city, its signal details (trade show / closure), sequence state
 * Outputs: ComposeContext — who it goes to (+ the address's check status in words), the details the service
 *          templates fill in, the service that fits the lead, and whether follow-ups are already running
 * Used by: app/api/leads/[id]/send-email/route.ts (GET) → components/outreach/SimpleEmailModal.tsx
 *
 * Read-only, no paid calls. Tolerates migrations 049 (signals) and 060 (seq_max_step) not being applied.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { fetchSignals } from "@/lib/lead-signal-data";
import { resolveSegment } from "@/lib/segment";
import { contactReadiness } from "@/lib/leads/contact-readiness";
import { defaultService, type ServiceKey } from "@/lib/email/service-templates";

export interface ComposeContext {
  leadId: string;
  businessName: string;
  email: string | null;
  emailLabel: string;
  emailTone: "positive" | "warning" | "urgent" | "muted";
  emailHint: string;
  canEmail: boolean;
  /** Never checked (or the check couldn't decide): the send checks it first, under 1 cent. */
  unchecked: boolean;
  ownerName: string | null;
  city: string | null;
  category: string | null;
  demoUrl: string | null;
  eventName: string | null;
  booth: string | null;
  segment: string;
  defaultService: ServiceKey;
  /** A sequence / follow-ups are already scheduled for this lead (sending with follow-ups replaces them). */
  followUpsActive: boolean;
}

type Row = {
  id: string;
  business_name: string;
  email: string | null;
  verification_status: string | null;
  phone: string | null;
  country_code: string | null;
  lifecycle_stage: string | null;
  call_status: string | null;
  contact_owner_name: string | null;
  category: string | null;
  demo_url: string | null;
  call_segment: string | null;
  website_kind: string | null;
  has_website: boolean | null;
  needs_improvement: boolean | null;
  seq_status: string | null;
  batch_id: string | null;
};

export async function loadComposeContext(leadId: string): Promise<ComposeContext | null> {
  const db = getDb();
  const { data } = await db
    .from("leads")
    .select(
      "id,business_name,email,verification_status,phone,country_code,lifecycle_stage,call_status,contact_owner_name," +
        "category,demo_url,call_segment,website_kind,has_website,needs_improvement,seq_status,batch_id",
    )
    .eq("id", leadId)
    .maybeSingle();
  const lead = data as Row | null;
  if (!lead) return null;

  const [signal, batch] = await Promise.all([
    fetchSignals({ ids: [lead.id] }).then((m) => m.get(lead.id) ?? null).catch(() => null),
    lead.batch_id
      ? db.from("batches").select("city").eq("id", lead.batch_id).maybeSingle().then((r) => (r.data as { city: string | null } | null) ?? null)
      : Promise.resolve(null),
  ]);
  const meta = signal?.signal_meta ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const segment = resolveSegment({ ...lead, signal_type: signal?.signal_type ?? null });
  const r = contactReadiness(lead);
  return {
    leadId: lead.id,
    businessName: lead.business_name,
    email: lead.email,
    emailLabel: r.email.label,
    emailTone: r.email.tone,
    emailHint: r.email.hint,
    canEmail: r.canEmail,
    unchecked: r.emailState === "unchecked",
    ownerName: lead.contact_owner_name,
    // A US-style "Austin, TX" batch city → the templates use the part before the comma.
    city: batch?.city ?? null,
    category: lead.category,
    demoUrl: lead.demo_url,
    eventName: str(meta.event_name),
    booth: str(meta.booth),
    segment,
    defaultService: defaultService(segment),
    followUpsActive: lead.seq_status === "active",
  };
}
