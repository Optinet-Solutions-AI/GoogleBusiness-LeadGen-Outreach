/**
 * (dashboard)/leads/[id]/page.tsx — Lead detail.
 *
 * 2-column layout. Left: identity, stage timeline, outreach log, notes.
 * Right (sticky): contact, meeting, improve, handover, danger zone.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, MapPin, Tag, Star, ExternalLink, ArrowLeft, Globe } from "lucide-react";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { StageChip } from "@/components/StageChip";
import { LeadActions } from "@/components/LeadActions";
import { AssistedDmPanel } from "@/components/AssistedDmPanel";
import { NextStepPill } from "@/components/NextStepPill";
import { StageTimeline as JourneyTimeline } from "@/components/StageTimeline";
import { ReverifyButton } from "@/components/ReverifyButton";
import { SequenceCard } from "@/components/SequenceCard";
import { relativeTime } from "@/lib/format";
import { countryLabel } from "@/lib/data/cities";
import { googleProfileUrl } from "@/lib/google";
import { isWebsiteBuildable } from "@/lib/data/niches";
import { isSocialKind, socialLabel } from "@/lib/social";
import { SegmentOverride } from "./SegmentOverride";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  batch_id: string;
  place_id: string | null;
  business_name: string;
  phone: string | null;
  address: string | null;
  country_code: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  email: string | null;
  brand_color: string | null;
  stage: string;
  demo_url: string | null;
  custom_domain: string | null;
  handover_mode: string | null;
  notes: string | null;
  last_error: string | null;
  rebuild_started_at: string | null;
  created_at: string;
  updated_at: string;
  // Offer routing + website audit (migration 016)
  primary_offer: "build_website" | "improve_website" | "voice_agent" | null;
  secondary_offer: "build_website" | "improve_website" | "voice_agent" | null;
  website_score: number | null;
  website_issues: string[] | null;
  needs_improvement: boolean | null;
  website_url: string | null;
  website_kind: string | null;
  // Segment override + website audit fields
  call_segment: string | null;
  website_status: string | null;
  has_website: boolean | null;
  offer_locked: boolean | null;
  // Email verification
  verification_status: string | null;
  verify_syntax_ok: boolean | null;
  verify_mx_ok: boolean | null;
  verify_smtp_result: string | null;
  verify_zerobounce_result: string | null;
  verify_millionverifier_result: string | null;
  verify_hunter_result: string | null;
  verified_at: string | null;
  // Screenshot-first email sequence (migration 034)
  screenshot_url: string | null;
  seq_status: string | null;
  seq_step: number | null;
  seq_next_step_at: string | null;
  seq_sender_email: string | null;
}

interface OutreachEvent {
  id: string;
  kind: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center max-w-2xl mx-auto">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">
          Set SUPABASE_URL + SUPABASE_SERVICE_KEY in Vercel to load lead detail.
        </p>
      </div>
    );
  }

  // Explicit columns (not select(*)) so we don't drag the heavy photos/reviews
  // jsonb the detail view never renders.
  const LEAD_COLS =
    "id,batch_id,place_id,business_name,phone,address,country_code,category,rating,review_count," +
    "email,brand_color,stage,demo_url,custom_domain,handover_mode,notes,last_error," +
    "rebuild_started_at,created_at,updated_at,primary_offer,secondary_offer," +
    "website_score,website_issues,needs_improvement,website_url,website_kind," +
    "call_segment,website_status,has_website,offer_locked," +
    "verification_status,verify_syntax_ok,verify_mx_ok,verify_smtp_result," +
    "verify_zerobounce_result,verify_millionverifier_result,verify_hunter_result,verified_at," +
    "screenshot_url,seq_status,seq_step,seq_next_step_at,seq_sender_email";

  // Lead + its outreach events are independent — fetch them together, not in a waterfall.
  const [lead, events] = await Promise.all([
    safeDb<Lead | null>(async (db) => {
      const { data } = await db.from("leads").select(LEAD_COLS).eq("id", params.id).single<Lead>();
      return data;
    }, null),
    safeDb<OutreachEvent[]>(async (db) => {
      const { data } = await db
        .from("outreach_events")
        .select("*")
        .eq("lead_id", params.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as OutreachEvent[];
    }, []),
  ]);
  if (!lead) notFound();

  // The batch carries template_slug (decides whether the website builder runs
  // for this lead's niche — only the 5 focus niches build) and country_code
  // (fallback for legacy lead rows that pre-date the migration-014 backfill).
  // Fetch it once.
  const batchRow = await safeDb<{ template_slug: string | null; country_code: string | null } | null>(
    async (db) => {
      const { data } = await db
        .from("batches")
        .select("template_slug,country_code")
        .eq("id", lead.batch_id)
        .single<{ template_slug: string | null; country_code: string | null }>();
      return data ?? null;
    },
    null,
  );
  const buildable = isWebsiteBuildable(batchRow?.template_slug);
  const countryCode: string | null = lead.country_code ?? batchRow?.country_code ?? null;

  return (
    <div className="max-w-6xl mx-auto">
      <Link href={`/batches/${lead.batch_id}`} className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to batch
      </Link>

      {/* Top-of-page next step + journey indicator */}
      <NextStepPill
        buildable={buildable}
        lead={{
          id: lead.id,
          stage: lead.stage,
          email: lead.email,
          demo_url: lead.demo_url,
          custom_domain: lead.custom_domain,
        }}
      />
      <div className="mb-6">
        <JourneyTimeline currentStage={lead.stage} />
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT */}
        <div className="lg:w-[60%] flex flex-col gap-6">
          <IdentityCard lead={lead} countryCode={countryCode} />
          <StageTimeline lead={lead} events={events} />
          <OutreachLog events={events} />
          <NotesPreview notes={lead.notes} />
        </div>

        {/* RIGHT */}
        <div className="lg:w-[40%] space-y-6">
          {isSocialKind(lead.website_kind) && (
            <AssistedDmPanel
              leadId={lead.id}
              businessName={lead.business_name}
              profileUrl={lead.website_url}
              platformLabel={socialLabel(lead.website_kind)}
              primaryOffer={lead.primary_offer}
            />
          )}
          <LeadActions
            buildable={buildable}
            lead={{
              id: lead.id,
              email: lead.email,
              stage: lead.stage,
              demo_url: lead.demo_url,
              custom_domain: lead.custom_domain,
              handover_mode: lead.handover_mode,
              rebuild_started_at: lead.rebuild_started_at,
            }}
          />
          <SequenceCard
            lead={{
              id: lead.id,
              email: lead.email,
              demo_url: lead.demo_url,
              screenshot_url: lead.screenshot_url,
              seq_status: lead.seq_status,
              seq_step: lead.seq_step,
              seq_next_step_at: lead.seq_next_step_at,
              seq_sender_email: lead.seq_sender_email,
            }}
          />
          <EmailVerificationCard lead={lead} />
        </div>
      </div>
    </div>
  );
}

function IdentityCard({ lead, countryCode }: { lead: Lead; countryCode: string | null }) {
  const country = countryLabel(countryCode);
  const sourceUrl = googleProfileUrl(lead);
  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="eyebrow mb-2">Lead</p>
          <div className="flex items-center flex-wrap gap-2 mb-1">
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                title="Open Google listing"
                className="editorial-head text-ink text-[28px] leading-none truncate inline-flex items-center gap-1.5 hover:text-action"
              >
                <span className="truncate">{lead.business_name}</span>
                <ExternalLink className="h-4 w-4 flex-none text-ink-subtle" strokeWidth={1.75} />
              </a>
            ) : (
              <h1 className="editorial-head text-ink text-[28px] leading-none truncate">
                {lead.business_name}
              </h1>
            )}
            <StageChip stage={lead.stage} />
          </div>
          {country && (
            <p className="text-ink text-[13px] flex items-center gap-1.5 mt-2 font-medium">
              <Globe className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
              {country}
              {countryCode && (
                <span className="mono-num text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
                  ({countryCode.toUpperCase()})
                </span>
              )}
            </p>
          )}
          {lead.address && (
            <p className="text-ink-muted text-[13px] flex items-center gap-1.5 mt-1">
              <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />
              {lead.address}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end flex-none">
          {typeof lead.rating === "number" && (
            <div className="flex items-center gap-1 text-warning">
              <Star className="h-4 w-4 fill-current" />
              <span className="mono-num text-[13px] font-semibold">{lead.rating.toFixed(1)}</span>
              {typeof lead.review_count === "number" && (
                <span className="text-ink-subtle text-[11px] mono-num">({lead.review_count})</span>
              )}
            </div>
          )}
          {lead.brand_color && (
            <div className="flex items-center gap-2 mt-2">
              <div className="h-3 w-3 rounded border border-rule" style={{ background: lead.brand_color }} />
              <span className="text-[11px] text-ink-subtle font-mono">{lead.brand_color}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-4 mt-4 border-t border-rule">
        <InfoRow icon={<Phone className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />} label="Phone" value={lead.phone ?? "—"} mono />
        <InfoRow icon={<Tag className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />} label="Category" value={lead.category ?? "—"} />
      </div>

      <div className="py-4 border-b border-rule space-y-2">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-[0.14em] font-mono">Website verdict</div>
        <div className="text-[13px] text-ink">{websiteVerdictLabel(lead)}</div>
        <SegmentOverride leadId={lead.id} segment={lead.call_segment} locked={!!lead.offer_locked} />
      </div>

      {lead.demo_url && (
        <a
          href={lead.demo_url}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary w-full mt-4"
        >
          Open demo
          <ExternalLink strokeWidth={1.75} />
        </a>
      )}

      {lead.last_error && (
        <div className="mt-4 px-3 py-2 rounded bg-urgent-soft border border-urgent/30 text-[12px] text-urgent">
          <span className="font-bold">Last error: </span>{lead.last_error}
        </div>
      )}
    </section>
  );
}

function websiteVerdictLabel(lead: Lead): string {
  if (lead.has_website === false) return "No real website — Build segment";
  const status = lead.website_status;
  if (!status) return "Not audited yet";
  if (status.includes("blocked")) return `Site returned ${status} — alive but we couldn't inspect it (verify manually)`;
  if (status === "timeout") return "Site timed out — couldn't verify (verify manually)";
  if (status === "404" || status === "410") return `Site is dead (${status}) — Improve/Build`;
  if (status === "dns_error" || status === "conn_refused") return `Domain doesn't resolve (${status}) — Improve/Build`;
  if (Number.isNaN(Number(status))) return `Couldn't verify (${status}) — review manually`;
  if (Number(status) >= 500) return `Server error (${status}) — Improve/Build`;
  if (Number(status) >= 400) return `Returned ${status} — couldn't verify, review manually`;
  const score = lead.website_score;
  return lead.needs_improvement
    ? `Reachable (${status}) but weak${score != null ? `, score ${score}` : ""} — Improve`
    : `Reachable (${status}), healthy${score != null ? `, score ${score}` : ""} — Discovery`;
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 bg-surface-alt rounded">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-[0.14em] font-mono">{label}</div>
        <div className={`text-[13px] font-medium text-ink truncate ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
    </div>
  );
}

function StageTimeline({ lead, events }: { lead: Lead; events: OutreachEvent[] }) {
  // Each step is "passed" only when concrete evidence exists — never inferred
  // from stage enum alone. A lead at stage='needs_email' must NOT show "Cold
  // email sent" as done just because needs_email sits after outreached in the
  // enum; same for terminal states like 'dead' that would otherwise light up
  // every step.
  const hasReplyEvent = events.some((e) => e.kind === "replied");
  const repliedOrAfter = ["replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won"].includes(lead.stage);
  const meetingDoneOrAfter = ["meeting_done", "improved", "handed_over", "closed_won"].includes(lead.stage);

  const steps: { title: string; hint?: string; passed: boolean }[] = [
    { title: "Lead captured", hint: "Source: Google Maps", passed: true },
    { title: "Enriched", hint: lead.brand_color ? `Brand color extracted (${lead.brand_color})` : "Photos + brand", passed: !!lead.brand_color },
    { title: "Site generated", hint: "Astro multi-page build", passed: !!lead.demo_url },
    { title: "Deployed", hint: lead.demo_url ?? "Cloudflare Pages", passed: !!lead.demo_url },
    { title: "Replied", hint: "Awaiting triage", passed: hasReplyEvent || repliedOrAfter },
    { title: "Meeting done", hint: "Decide: improve or handover", passed: meetingDoneOrAfter },
    { title: "Handed over", hint: lead.custom_domain ? `Live on ${lead.custom_domain}` : undefined, passed: lead.stage === "handed_over" && !!lead.custom_domain },
  ];

  // "Current" = the next unmet step, i.e. where operator attention sits. For
  // terminal stages (dead / closed_lost / closed_won) we suppress it — nothing
  // is "in progress" anymore.
  const terminal = ["dead", "closed_lost", "closed_won"].includes(lead.stage);
  const currentIdx = terminal ? -1 : steps.findIndex((s) => !s.passed);

  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <h2 className="eyebrow mb-6">Stage timeline</h2>
      <div className="relative flex flex-col gap-7 ml-3">
        <div className="absolute left-0 top-2 bottom-2 w-px bg-rule" />
        {steps.map((s, i) => {
          const current = i === currentIdx;
          return (
            <div key={s.title} className="relative pl-8 flex flex-col">
              <div
                className={[
                  "absolute left-[-4px] top-1 h-2 w-2 rounded-full border-2 border-surface",
                  current ? "bg-action ring-4 ring-action/15" : s.passed ? "bg-positive" : "bg-ink-subtle/40",
                ].join(" ")}
              />
              <div className="flex justify-between items-start">
                <span
                  className={`text-[13px] font-semibold ${current ? "text-action" : s.passed ? "text-ink" : "text-ink-subtle"}`}
                >
                  {s.title}
                </span>
              </div>
              {s.hint && s.passed && (
                <p className="text-[11px] mt-1 text-ink-muted">{s.hint}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Human label for an outreach event — annotates a sequence send with its step. */
function outreachLabel(e: OutreachEvent): string {
  const base = e.kind.replaceAll("_", " ");
  const step = e.meta?.step;
  if (e.kind === "email_sent" && typeof step === "number") return `${base} (step ${step} of 4)`;
  return base;
}

function OutreachLog({ events }: { events: OutreachEvent[] }) {
  if (events.length === 0) {
    return (
      <section className="bg-surface border border-rule rounded-lg p-6 text-[13px] text-ink-muted">
        <h2 className="eyebrow mb-3">Outreach log</h2>
        No outreach events yet.
      </section>
    );
  }
  return (
    <section className="bg-surface border border-rule rounded-lg overflow-clip">
      <div className="px-6 py-4 border-b border-rule flex justify-between items-center">
        <h2 className="eyebrow">Outreach log</h2>
        <span className="mono-num text-[11px] bg-surface-alt px-2 py-0.5 rounded text-ink-muted">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      <table className="w-full text-left">
        <thead className="bg-surface-alt border-b border-rule sticky top-14 z-20">
          <tr>
            <th className="px-6 py-2 text-label-caps text-ink-muted uppercase tracking-[0.18em]">Event</th>
            <th className="px-6 py-2 text-label-caps text-ink-muted uppercase tracking-[0.18em]">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {events.map((e) => (
            <tr key={e.id} className="h-10 hover:bg-surface-alt transition-colors">
              <td className="px-6 text-[13px] text-ink">{outreachLabel(e)}</td>
              <td className="px-6 mono-num text-[11px] text-ink-subtle">{relativeTime(e.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NotesPreview({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <h2 className="eyebrow mb-3">Operator notes</h2>
      <pre className="text-[13px] text-ink whitespace-pre-wrap font-sans leading-relaxed">{notes}</pre>
    </section>
  );
}

// ── Verification status chip ──────────────────────────────────────────────────

type VerifTone = "positive" | "urgent" | "warning" | "neutral";

const VERIF_TONE: Record<string, VerifTone> = {
  valid:     "positive",
  invalid:   "urgent",
  "catch-all": "warning",
  unknown:   "neutral",
};

const VERIF_TONE_CLASS: Record<VerifTone, string> = {
  positive: "bg-positive-soft text-positive",
  urgent:   "bg-urgent-soft text-urgent",
  warning:  "bg-warning-soft text-warning",
  neutral:  "bg-surface-alt text-ink-muted",
};

function VerifChip({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.14em] font-mono bg-surface-alt text-ink-muted">
        Not verified yet
      </span>
    );
  }
  const tone = VERIF_TONE[status] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.14em] font-mono ${VERIF_TONE_CLASS[tone]}`}
    >
      {status}
    </span>
  );
}

// ── Verification card ─────────────────────────────────────────────────────────

function EmailVerificationCard({ lead }: { lead: Lead }) {
  const auditRows: { label: string; value: string | null }[] = [
    { label: "Syntax",          value: lead.verify_syntax_ok == null ? null : lead.verify_syntax_ok ? "ok" : "fail" },
    { label: "MX",              value: lead.verify_mx_ok == null ? null : lead.verify_mx_ok ? "ok" : "fail" },
    { label: "SMTP",            value: lead.verify_smtp_result },
    { label: "ZeroBounce",      value: lead.verify_zerobounce_result },
    { label: "MillionVerifier", value: lead.verify_millionverifier_result },
    { label: "Hunter",          value: lead.verify_hunter_result },
  ].filter((r) => r.value != null) as { label: string; value: string }[];

  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <p className="eyebrow mb-3">Email verification</p>

      <div className="flex items-center justify-between gap-2 mb-4">
        <VerifChip status={lead.verification_status} />
        {lead.email && <ReverifyButton leadId={lead.id} />}
      </div>

      {auditRows.length > 0 && (
        <div className="divide-y divide-rule border border-rule rounded text-[12px] mb-3">
          {auditRows.map((r) => (
            <div key={r.label} className="flex justify-between items-center px-3 py-1.5">
              <span className="text-ink-muted font-medium">{r.label}</span>
              <span className="mono-num text-ink">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {lead.verified_at && (
        <p className="text-[11px] text-ink-subtle">
          Last verified {relativeTime(lead.verified_at)}
        </p>
      )}

      {!lead.email && (
        <p className="text-[12px] text-ink-muted">No email address on record.</p>
      )}
    </section>
  );
}
