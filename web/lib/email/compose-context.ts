/**
 * email/compose-context.ts — everything the Send email window needs about one lead, in one read.
 *
 * Inputs:  lead id; the lead row, its batch's city, its signal details (trade show / closure), sequence state
 * Outputs: ComposeContext — who it goes to (+ the address's check status in words), the details the service
 *          templates fill in, the service that fits the lead, whether follow-ups are already running, and the
 *          running wording tests + past winners (lib/email/email-tests.ts)
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
import { pickOptiRateSender } from "@/lib/email/optirate-sender";
import { getRampedDailyCap } from "@/lib/services/email-sender";
import { listTests, runningWithNext, winnersByOffer } from "@/lib/email/email-tests";
import type { WindowTest } from "@/lib/email/wording-test";

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
  /** Review-site leads: "Trustpilot" / "TripAdvisor", their rating and review count there. */
  platform: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** The mailbox the window should start on (reputation leads: an OptiRate mailbox), or null = the first one. */
  preferredSender: string | null;
  segment: string;
  defaultService: ServiceKey;
  /** A sequence / follow-ups are already scheduled for this lead (sending with follow-ups replaces them). */
  followUpsActive: boolean;
  /** Running wording tests (24 Nov 2026): picking that offer fills the version whose turn it is. */
  wordingTests: WindowTest[];
  /** Per offer, the email that won its last wording test ("saved:<id>"), filled instead of the ready-made one. */
  winners: Record<string, string>;
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

  const [signal, batch, running, finished] = await Promise.all([
    fetchSignals({ ids: [lead.id] }).then((m) => m.get(lead.id) ?? null).catch(() => null),
    lead.batch_id
      ? db.from("batches").select("city").eq("id", lead.batch_id).maybeSingle().then((r) => (r.data as { city: string | null } | null) ?? null)
      : Promise.resolve(null),
    // Wording tests never block the window: no table (066) or a failed read = no test.
    runningWithNext().catch(() => []),
    listTests().then((r) => r.tests).catch(() => []),
  ]);
  const meta = signal?.signal_meta ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const segment = resolveSegment({ ...lead, signal_type: signal?.signal_type ?? null });
  const r = contactReadiness({ ...lead, signal_type: signal?.signal_type ?? null });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const platform = str(meta.platform);
  const preferredSender = segment === "reputation" ? await optiRateSender(db).catch(() => null) : null;
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
    platform: platform ? PLATFORM_NAME[platform] ?? platform : null,
    rating: num(meta.rating),
    reviewCount: num(meta.review_count),
    preferredSender,
    segment,
    defaultService: defaultService(segment),
    followUpsActive: lead.seq_status === "active",
    wordingTests: running.map((t) => ({ id: t.id, serviceKey: t.service_key, next: t.next, aKey: t.a_key, bKey: t.b_key })),
    winners: winnersByOffer(finished),
  };
}

const PLATFORM_NAME: Record<string, string> = { trustpilot: "Trustpilot", tripadvisor: "TripAdvisor" };

/** The OptiRate mailbox with the most of today's warm-up allowance left (sends counted over the last 24 hours). */
async function optiRateSender(db: ReturnType<typeof getDb>): Promise<string | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [{ data: accounts }, { data: sent }] = await Promise.all([
    db
      .from("email_accounts")
      .select("email,from_name,daily_cap,warmup_started_at,warmup_target_cap,warmup_ramp_days")
      .eq("status", "active"),
    db.from("email_messages").select("from_addr").eq("direction", "outbound").gte("created_at", since).limit(5000),
  ]);
  const counts = new Map<string, number>();
  for (const m of (sent ?? []) as { from_addr: string | null }[]) {
    const k = (m.from_addr ?? "").toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  type Acc = { email: string; from_name: string | null; daily_cap: number | null; warmup_started_at: string | null; warmup_target_cap: number | null; warmup_ramp_days: number | null };
  return pickOptiRateSender(
    ((accounts ?? []) as Acc[]).map((a) => ({
      email: a.email,
      sentToday: counts.get(a.email.toLowerCase()) ?? 0,
      cap: getRampedDailyCap({ email: a.email, fromName: a.from_name, daily_cap: a.daily_cap, warmup_started_at: a.warmup_started_at, warmup_target_cap: a.warmup_target_cap, warmup_ramp_days: a.warmup_ramp_days }),
    })),
  );
}
