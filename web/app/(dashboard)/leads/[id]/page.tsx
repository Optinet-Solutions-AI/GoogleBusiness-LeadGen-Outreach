/**
 * (dashboard)/leads/[id]/page.tsx — Lead detail.
 *
 * 2-column layout. Left: identity, stage timeline, outreach log, notes.
 * Right (sticky): contact, meeting, improve, handover, danger zone.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, MapPin, Tag, Star, ExternalLink, ArrowLeft } from "lucide-react";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { StageChip } from "@/components/StageChip";
import { LeadActions } from "@/components/LeadActions";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  batch_id: string;
  business_name: string;
  phone: string | null;
  address: string | null;
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
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center max-w-2xl mx-auto">
        <h1 className="text-headline-sm text-slate-900 mb-2">Supabase not configured</h1>
        <p className="text-sm text-slate-500">
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
      <Link href={`/batches/${lead.batch_id}`} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to batch
      </Link>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT */}
        <div className="lg:w-[60%] flex flex-col gap-6">
          <IdentityCard lead={lead} />
          <StageTimeline lead={lead} events={events} />
          <OutreachLog events={events} />
          <NotesPreview notes={lead.notes} />
        </div>

        {/* RIGHT */}
        <div className="lg:w-[40%]">
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

function IdentityCard({ lead }: { lead: Lead }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 truncate">{lead.business_name}</h1>
            <StageChip stage={lead.stage} />
          </div>
          {lead.address && (
            <p className="text-slate-500 text-body-sm flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {lead.address}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end flex-none">
          {typeof lead.rating === "number" && (
            <div className="flex items-center gap-1 text-amber-500">
              <Star className="h-4 w-4 fill-current" />
              <span className="font-mono text-sm">{lead.rating.toFixed(1)}</span>
              {typeof lead.review_count === "number" && (
                <span className="text-slate-400 text-xs">({lead.review_count})</span>
              )}
            </div>
          )}
          {lead.brand_color && (
            <div className="flex items-center gap-2 mt-2">
              <div className="h-3 w-3 rounded-full border border-slate-300" style={{ background: lead.brand_color }} />
              <span className="text-xs text-slate-400 font-mono">{lead.brand_color}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-4 mt-4 border-y border-slate-100">
        <InfoRow icon={<Phone className="h-4 w-4 text-slate-500" />} label="Phone" value={lead.phone ?? "—"} mono />
        <InfoRow icon={<Tag className="h-4 w-4 text-slate-500" />} label="Category" value={lead.category ?? "—"} />
      </div>

      {lead.demo_url && (
        <a
          href={lead.demo_url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 w-full py-2.5 bg-brand text-white rounded-full text-headline-sm flex items-center justify-center gap-2 hover:opacity-90"
        >
          Open demo
          <ExternalLink className="h-4 w-4" />
        </a>
      )}

      {lead.last_error && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-700">
          <span className="font-bold">Last error: </span>{lead.last_error}
        </div>
      )}
    </section>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 bg-slate-50 rounded-lg">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
        <div className={`text-sm font-medium truncate ${mono ? "font-mono" : ""}`}>{value}</div>
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
  const hasEmailSent = events.some((e) => e.kind === "email_sent");
  const hasReplyEvent = events.some((e) => e.kind === "replied");
  const repliedOrAfter = ["replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won"].includes(lead.stage);
  const meetingDoneOrAfter = ["meeting_done", "improved", "handed_over", "closed_won"].includes(lead.stage);

  const steps: { title: string; hint?: string; passed: boolean }[] = [
    { title: "Lead captured", hint: "Source: Google Maps", passed: true },
    { title: "Enriched", hint: lead.brand_color ? `Brand color extracted (${lead.brand_color})` : "Photos + brand", passed: !!lead.brand_color },
    { title: "Site generated", hint: "Astro multi-page build", passed: !!lead.demo_url },
    { title: "Deployed", hint: lead.demo_url ?? "Cloudflare Pages", passed: !!lead.demo_url },
    { title: "Cold email sent", hint: "Via Instantly", passed: hasEmailSent },
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
    <section className="bg-white border border-slate-200 rounded-lg p-6">
      <h2 className="text-label-caps text-slate-400 uppercase mb-6 tracking-wider">Stage timeline</h2>
      <div className="relative flex flex-col gap-7 ml-3">
        <div className="absolute left-0 top-2 bottom-2 w-px bg-slate-200" />
        {steps.map((s, i) => {
          const current = i === currentIdx;
          return (
            <div key={s.title} className="relative pl-8 flex flex-col">
              <div
                className={[
                  "absolute left-[-4px] top-1 h-2 w-2 rounded-full border border-white",
                  current ? "bg-brand ring-4 ring-brand/15" : s.passed ? "bg-emerald-500" : "bg-slate-300",
                ].join(" ")}
              />
              <div className="flex justify-between items-start">
                <span className={`text-sm font-semibold ${current ? "text-brand" : s.passed ? "text-slate-900" : "text-slate-400"}`}>
                  {s.title}
                </span>
              </div>
              {s.hint && s.passed && (
                <p className="text-xs mt-1 text-slate-500">{s.hint}</p>
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
      <section className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
        <h2 className="text-label-caps text-slate-400 uppercase mb-3 tracking-wider">Outreach log</h2>
        No outreach events yet.
      </section>
    );
  }
  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
        <h2 className="text-label-caps text-slate-400 uppercase tracking-wider">Outreach log</h2>
        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      <table className="w-full text-left">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-6 py-2 text-label-caps text-slate-500 uppercase">Event</th>
            <th className="px-6 py-2 text-label-caps text-slate-500 uppercase">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {events.map((e) => (
            <tr key={e.id} className="h-10 hover:bg-slate-50">
              <td className="px-6 text-body-sm text-slate-700">{e.kind.replaceAll("_", " ")}</td>
              <td className="px-6 font-mono text-xs text-slate-500">{relativeTime(e.created_at)}</td>
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
    <section className="bg-white border border-slate-200 rounded-lg p-6">
      <h2 className="text-label-caps text-slate-400 uppercase mb-3 tracking-wider">Operator notes</h2>
      <pre className="text-body-sm text-slate-700 whitespace-pre-wrap font-sans">{notes}</pre>
    </section>
  );
}
