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
import { VoiceOutreachCard } from "@/components/VoiceOutreachCard";
import { NextStepPill } from "@/components/NextStepPill";
import { StageTimeline as JourneyTimeline } from "@/components/StageTimeline";
import { relativeTime } from "@/lib/format";
import { countryLabel } from "@/lib/data/cities";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  batch_id: string;
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
  call_status: string | null;
  website_score: number | null;
  website_issues: string[] | null;
  needs_improvement: boolean | null;
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

  const lead = await safeDb<Lead | null>(async (db) => {
    const { data } = await db.from("leads").select("*").eq("id", params.id).single<Lead>();
    return data;
  }, null);
  if (!lead) notFound();

  // Country normally lives on the lead row (denormalized from batches.country_code
  // by migration 014). For legacy rows that pre-date the backfill, fall back to
  // climbing the FK to the batch.
  let countryCode: string | null = lead.country_code;
  if (!countryCode) {
    countryCode = await safeDb<string | null>(async (db) => {
      const { data } = await db
        .from("batches")
        .select("country_code")
        .eq("id", lead.batch_id)
        .single<{ country_code: string | null }>();
      return data?.country_code ?? null;
    }, null);
  }

  const events = await safeDb<OutreachEvent[]>(async (db) => {
    const { data } = await db
      .from("outreach_events")
      .select("*")
      .eq("lead_id", params.id)
      .order("created_at", { ascending: false });
    return (data ?? []) as OutreachEvent[];
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <Link href={`/batches/${lead.batch_id}`} className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to batch
      </Link>

      {/* Top-of-page next step + journey indicator */}
      <NextStepPill
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
          <VoiceOutreachCard
            lead={{
              id: lead.id,
              phone: lead.phone,
              primary_offer: lead.primary_offer,
              secondary_offer: lead.secondary_offer,
              call_status: lead.call_status,
              website_score: lead.website_score,
              website_issues: lead.website_issues,
            }}
          />
          <LeadActions
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
        </div>
      </div>
    </div>
  );
}

function IdentityCard({ lead, countryCode }: { lead: Lead; countryCode: string | null }) {
  const country = countryLabel(countryCode);
  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="eyebrow mb-2">Lead</p>
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <h1 className="editorial-head text-ink text-[28px] leading-none truncate">
              {lead.business_name}
            </h1>
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

      <div className="grid grid-cols-2 gap-4 py-4 mt-4 border-y border-rule">
        <InfoRow icon={<Phone className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />} label="Phone" value={lead.phone ?? "—"} mono />
        <InfoRow icon={<Tag className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />} label="Category" value={lead.category ?? "—"} />
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
  const hasCallPlaced = events.some((e) => e.kind === "call_placed");
  const hasReplyEvent = events.some((e) => e.kind === "replied");
  const repliedOrAfter = ["replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won"].includes(lead.stage);
  const meetingDoneOrAfter = ["meeting_done", "improved", "handed_over", "closed_won"].includes(lead.stage);

  const steps: { title: string; hint?: string; passed: boolean }[] = [
    { title: "Lead captured", hint: "Source: Google Maps", passed: true },
    { title: "Enriched", hint: lead.brand_color ? `Brand color extracted (${lead.brand_color})` : "Photos + brand", passed: !!lead.brand_color },
    { title: "Site generated", hint: "Astro multi-page build", passed: !!lead.demo_url },
    { title: "Deployed", hint: lead.demo_url ?? "Cloudflare Pages", passed: !!lead.demo_url },
    { title: "Call placed", hint: "Voice outreach", passed: hasCallPlaced },
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
    <section className="bg-surface border border-rule rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-rule flex justify-between items-center">
        <h2 className="eyebrow">Outreach log</h2>
        <span className="mono-num text-[11px] bg-surface-alt px-2 py-0.5 rounded text-ink-muted">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      <table className="w-full text-left">
        <thead className="bg-surface-alt border-b border-rule">
          <tr>
            <th className="px-6 py-2 text-label-caps text-ink-muted uppercase tracking-[0.18em]">Event</th>
            <th className="px-6 py-2 text-label-caps text-ink-muted uppercase tracking-[0.18em]">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {events.map((e) => (
            <tr key={e.id} className="h-10 hover:bg-surface-alt transition-colors">
              <td className="px-6 text-[13px] text-ink">{e.kind.replaceAll("_", " ")}</td>
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
