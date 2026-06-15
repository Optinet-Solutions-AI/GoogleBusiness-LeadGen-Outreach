/**
 * (dashboard)/batches/[id]/page.tsx — Batch detail.
 *
 * 4 stat cards, a stage funnel, and a filterable lead table for this batch.
 */

import Link from "next/link";
import { Download, ChevronRight, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { REJECTION_REASON_LABEL } from "@/lib/filters";
import { StatusChip } from "@/components/StatusChip";
import { LeadBadges } from "@/components/LeadBadges";
import { googleProfileUrl } from "@/lib/google";
import { StageChip } from "@/components/StageChip";
import { StageFunnel } from "@/components/StageFunnel";
import { FunnelChart, type FunnelStage } from "@/components/FunnelChart";
import { StatCard } from "@/components/StatCard";
import { loadAnalytics } from "@/lib/analytics";
import { BatchProgressPoller } from "@/components/BatchProgressPoller";
import { RerunButton } from "@/components/RerunButton";

export const dynamic = "force-dynamic";

interface Batch {
  id: string;
  niche: string;
  city: string;
  status: string;
  limit: number | null;
  template_slug: string;
  scraper: string;
  scraped_count: number | null;
  rejected_count: number | null;
  rejection_reasons: Record<string, number> | null;
  updated_at: string;
}

interface BatchLead {
  id: string;
  business_name: string;
  address: string | null;
  stage: string;
  email: string | null;
  demo_url: string | null;
  last_error: string | null;
  created_at: string;
  qualified: boolean | null;
  rejection_reason: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  has_website: boolean | null;
  phone: string | null;
  website_url: string | null;
  website_kind: import("@/components/LeadBadges").WebsiteKind | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  category_off_niche: boolean | null;
  language_code: string | null;
  primary_offer: "build_website" | "improve_website" | "voice_agent" | null;
  needs_improvement: boolean | null;
  website_score: number | null;
  call_segment: string | null;
  place_id: string | null;
}

export default async function BatchDetailPage({ params }: { params: { id: string } }) {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">
          Set SUPABASE_URL + SUPABASE_SERVICE_KEY in Vercel to load batch detail.
        </p>
      </div>
    );
  }

  const batch = await safeDb<Batch | null>(async (db) => {
    const { data } = await db.from("batches").select("*").eq("id", params.id).single();
    return data as Batch | null;
  }, null);
  if (!batch) notFound();

  const allLeads = await safeDb<BatchLead[]>(
    async (db) => {
      const { data } = await db
        .from("leads")
        .select(
          "id,business_name,address,stage,email,demo_url,last_error,created_at,place_id," +
            "qualified,rejection_reason,category,rating,review_count,has_website,phone," +
            "website_url,website_kind,business_status,is_service_area_only,is_franchise_flagged,language_code," +
            "category_off_niche,primary_offer,needs_improvement,website_score,call_segment",
        )
        .eq("batch_id", params.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as BatchLead[];
    },
    [],
  );

  const qualifiedLeads = allLeads.filter((l) => l.qualified !== false);
  const rejectedLeads = allLeads.filter((l) => l.qualified === false);

  const counts: Record<string, number> = {};
  for (const lead of qualifiedLeads) counts[lead.stage] = (counts[lead.stage] ?? 0) + 1;

  const qualified = qualifiedLeads.length;
  const scraped = batch.scraped_count ?? qualifiedLeads.length;
  const rejected = batch.rejected_count ?? rejectedLeads.length;
  const deployed = (counts.deployed ?? 0) + (counts.outreached ?? 0) + (counts.replied ?? 0) +
                   (counts.meeting_booked ?? 0) + (counts.meeting_done ?? 0) +
                   (counts.improved ?? 0) + (counts.handed_over ?? 0) + (counts.closed_won ?? 0);
  const replies = counts.replied ?? 0;
  const allRejected = scraped > 0 && qualified === 0;
  const leads = qualifiedLeads;

  // SMS + email conversion funnel for this batch.
  const voice = await loadAnalytics(params.id);
  const voiceByKey = new Map(voice.funnel.map((s) => [s.key, s] as const));
  const voiceStages: FunnelStage[] = (
    [
      ["leads",    "/leads"],
      ["texted",   "/inbox"],
      ["clicked",  "/inbox"],
      ["finished", "/inbox"],
    ] as const
  ).map(([key, href]) => {
    const step = voiceByKey.get(key) ?? { key, label: key, count: 0 };
    return { key, label: step.label, count: step.count, href };
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <nav className="flex items-center text-[11px] font-mono uppercase tracking-[0.14em] text-ink-subtle mb-2">
            <Link href="/batches" className="hover:text-ink transition-colors">Batches</Link>
            <span className="mx-2">/</span>
            <span className="text-ink-muted">{batch.id.slice(0, 8)}</span>
          </nav>
          <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none capitalize">
            {batch.niche}{" "}
            <span className="text-ink-subtle font-normal">/</span>{" "}
            <span className="text-ink-muted font-normal">{batch.city}</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <StatusChip status={batch.status} />
          <a
            href={`/api/batches/${batch.id}/export`}
            title="Export phone-reachable leads (CSV) for outreach"
            className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
          <RerunButton id={batch.id} />
        </div>
      </header>

      {batch.status === "running" && (
        <BatchProgressPoller batchId={batch.id} startedAt={batch.updated_at} />
      )}

      {batch.status === "queued" && (
        <div className="rounded bg-surface-alt border border-rule px-4 py-3 text-[13px] text-ink-muted">
          Queued. Click <span className="font-semibold text-ink">Re-run</span> above to start the scrape.
        </div>
      )}

      {batch.status === "failed" && (
        <div className="rounded bg-urgent-soft border border-urgent/30 px-4 py-3 text-[13px] text-urgent">
          <p className="font-bold mb-1">This batch failed.</p>
          <p>
            Click <span className="font-semibold">Re-run</span> above to retry, or check the build logs in
            Vercel for details.
          </p>
        </div>
      )}

      {batch.status === "done" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Scraped" value={scraped} hint={`${batch.limit ?? 0} requested`} />
            <StatCard
              label="Qualified"
              value={qualified}
              emphasis
              hint={scraped > 0 ? `${Math.round((qualified / scraped) * 100)}% pass rate` : undefined}
              hintTone={allRejected ? "warning" : "neutral"}
            />
            <StatCard
              label="Deployed"
              value={deployed}
              emphasis
              hint={qualified > 0 ? `${Math.round((deployed / qualified) * 100)}% live` : undefined}
            />
            <StatCard
              label="Replies"
              value={replies}
              hint={deployed > 0 ? `${((replies / deployed) * 100).toFixed(1)}% rate` : undefined}
              hintTone="positive"
            />
          </div>

          {allRejected && (
            <RejectionBreakdown
              niche={batch.niche}
              scraped={scraped}
              reasons={batch.rejection_reasons ?? {}}
            />
          )}

          {qualified > 0 && <StageFunnel counts={counts} />}

          {qualified > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Outreach funnel</span>
                <Link href="/analytics" className="text-[11.5px] text-action hover:underline">
                  Full analytics →
                </Link>
              </div>
              <FunnelChart
                stages={voiceStages}
                title="Text → click → form"
                caption={
                  voice.is_empty
                    ? "no messages sent yet — ready to track"
                    : `${voice.rates.overall ?? 0}% lead→finished`
                }
              />
            </section>
          )}
        </>
      )}

      {qualified > 0 && (
        <section>
          <div className="flex items-center justify-between border-b border-rule pb-2 mb-4">
            <div className="flex space-x-6">
              <button className="text-[13px] font-semibold text-action border-b-2 border-action pb-2 px-1">
                All leads ({qualified})
              </button>
              {(counts.needs_email ?? 0) > 0 && (
                <span className="text-[13px] text-ink-muted pb-2 px-1">
                  Needs email ({counts.needs_email})
                </span>
              )}
              {replies > 0 && (
                <span className="text-[13px] text-ink-muted pb-2 px-1">Replied ({replies})</span>
              )}
              {(counts.dead ?? 0) > 0 && (
                <span className="text-[13px] text-ink-muted pb-2 px-1">Dead ({counts.dead})</span>
              )}
            </div>
          </div>

          <div className="bg-surface border border-rule rounded-lg overflow-clip">
            <table className="w-full text-left">
              <thead className="bg-surface-alt border-b border-rule sticky top-14 z-20">
                <tr>
                  <Th>Business / city</Th>
                  <Th>Stage</Th>
                  <Th>Email</Th>
                  <Th>Demo URL</Th>
                  <Th>Last error</Th>
                  <Th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[13px] text-ink-muted">
                      No leads scraped yet.
                    </td>
                  </tr>
                )}
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-surface-alt transition-colors">
                    <td className="px-4 py-2.5">
                      {googleProfileUrl(lead) ? (
                        <a
                          href={googleProfileUrl(lead)!}
                          target="_blank"
                          rel="noreferrer"
                          title="View on Google Business Profile"
                          className="inline-flex items-center gap-1 text-[14px] font-semibold text-ink hover:text-action hover:underline"
                        >
                          {lead.business_name}
                          <ExternalLink className="h-3 w-3 flex-none opacity-60" aria-hidden />
                        </a>
                      ) : (
                        <div className="text-[14px] font-semibold text-ink">{lead.business_name}</div>
                      )}
                      <div className="text-[11px] text-ink-subtle">{lead.address ?? "—"}</div>
                      <div className="mt-1">
                        <LeadBadges lead={lead} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><StageChip stage={lead.stage} /></td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted">
                      {lead.email ?? <span className="text-ink-subtle">needs email</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {lead.demo_url ? (
                        <a
                          href={lead.demo_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mono-num text-[13px] text-action hover:underline truncate block max-w-[200px]"
                        >
                          {lead.demo_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-ink-subtle text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {lead.last_error ? (
                        <span className="text-[12px] text-urgent line-clamp-1 max-w-[260px] block">
                          {lead.last_error}
                        </span>
                      ) : (
                        <span className="text-ink-subtle text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/leads/${lead.id}`} title="Open lead" className="text-ink-subtle hover:text-ink transition-colors inline-block">
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {batch.status === "done" && rejectedLeads.length > 0 && (
        <RejectedLeadsTable leads={rejectedLeads} />
      )}
    </div>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}

function RejectedLeadsTable({ leads }: { leads: BatchLead[] }) {
  function parseReason(raw: string | null): { key: string; detail: string | null } {
    if (!raw) return { key: "unknown", detail: null };
    const idx = raw.indexOf(":");
    if (idx < 0) return { key: raw, detail: null };
    return { key: raw.slice(0, idx).trim(), detail: raw.slice(idx + 1).trim() };
  }

  return (
    <section>
      <div className="flex items-center justify-between border-b border-rule pb-2 mb-4">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">
            Rejected leads ({leads.length})
          </h2>
          <p className="text-[11px] text-ink-muted mt-0.5">
            These leads were scraped but didn&apos;t pass the qualifier filter. Skim them to sanity-check what got cut.
          </p>
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-lg overflow-clip">
        <table className="w-full text-left">
          <thead className="bg-surface-alt border-b border-rule sticky top-14 z-20">
            <tr>
              <Th>Business</Th>
              <Th>Why rejected</Th>
              <Th>Category</Th>
              <Th>Rating</Th>
              <Th>Reviews</Th>
              <Th>Website</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {leads.map((lead) => {
              const { key, detail } = parseReason(lead.rejection_reason);
              return (
                <tr key={lead.id} className="hover:bg-surface-alt transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="text-[13px] font-medium text-ink">{lead.business_name}</div>
                    <div className="text-[11px] text-ink-subtle">{lead.address ?? "—"}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-[12px] font-medium text-warning">
                      {REJECTION_REASON_LABEL[key] ?? key}
                    </div>
                    {detail && (
                      <div className="text-[11px] text-ink-subtle font-mono">{detail}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[12px] text-ink-muted">
                    {lead.category ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[12px] text-ink-muted">
                    {lead.rating != null ? `${lead.rating.toFixed(1)}★` : "—"}
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[12px] text-ink-muted">
                    {lead.review_count ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-[12px]">
                    {lead.has_website ? (
                      <span className="text-urgent font-semibold">Yes</span>
                    ) : (
                      <span className="text-positive">No</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RejectionBreakdown({
  niche,
  scraped,
  reasons,
}: {
  niche: string;
  scraped: number;
  reasons: Record<string, number>;
}) {
  const sorted = Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);

  const dominant = sorted[0]?.[0];
  let suggestion: React.ReactNode;
  if (dominant === "has_website") {
    suggestion = (
      <>
        Almost every result already has a real website. Try a less-saturated market:
        a niche with more solo operators (<span className="font-semibold">mobile mechanic, pool cleaning, pressure washing, lawn care, mobile dog grooming</span>)
        OR a smaller suburb (<span className="font-semibold">Round Rock, Pflugerville, Cedar Park, San Marcos</span>).
      </>
    );
  } else if (dominant === "low_rating") {
    suggestion = (
      <>
        Too many low-rated businesses. Either the city has poor service quality, or you may want to lower MIN_RATING further in{" "}
        <code className="font-mono text-[12px] bg-warning-soft px-1 py-0.5 rounded">web/lib/filters.ts</code>.
      </>
    );
  } else if (dominant === "few_reviews") {
    suggestion = (
      <>Most results don&apos;t have enough reviews. The market may be very new, or these may be auto-generated dummy listings. Try a different city.</>
    );
  } else if (dominant === "no_phone") {
    suggestion = <>Many results lack a phone — usually means digital-only or dummy listings. Try a different niche/city.</>;
  } else if (dominant === "category_mismatch") {
    suggestion = <>Google&apos;s category strings don&apos;t match your niche query. Try the exact term Google uses (e.g. &quot;Plumber&quot; instead of &quot;plumbing&quot;).</>;
  } else {
    suggestion = <>Try a different niche or city.</>;
  }

  return (
    <div className="rounded bg-warning-soft border border-warning/30 px-4 py-3 text-[13px] text-warning leading-relaxed space-y-2">
      <p className="font-bold">
        Scraped {scraped} {niche}s, but every one was filtered out.
      </p>
      <p>The scraper is working — these are the reasons each lead was rejected:</p>
      <ul className="bg-warning/10 rounded p-2 space-y-1">
        {sorted.map(([key, count]) => (
          <li key={key} className="flex justify-between font-mono text-[12px]">
            <span>{REJECTION_REASON_LABEL[key] ?? key}</span>
            <span className="font-bold">{count}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px]">
        <span className="font-semibold">Suggestion: </span>
        {suggestion}
      </p>
    </div>
  );
}
