/**
 * (dashboard)/campaigns/page.tsx — Campaign list (table).
 *
 * Inputs:  call_campaigns + campaign_leads via safeDb
 * Outputs: a table — name | segment | country | category | leads | contacted | interested | success% | status
 * Used by: route "/campaigns"
 *
 * "Contacted" = members no longer `pending` (dialed at least once). "Interested" = positive
 * call outcomes. Success rate = interested / contacted — the voice analogue of a reply/conversion
 * rate. All computed from the campaign_leads.status counts (no extra query).
 */

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { NewCampaignForm } from "@/components/NewCampaignForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

interface Campaign {
  id: string;
  name: string;
  source: string;
  segment: string | null;
  channel: string | null;
  country_code: string | null;
  category: string | null;
  status: string;
  created_at: string;
}

interface CampaignLeadRow {
  campaign_id: string;
  status: string;
}

interface Counts {
  total: number;
  contacted: number; // total - pending
  interested: number;
}

const SEGMENT_META: Record<string, { label: string; tone: string }> = {
  no_website: { label: "Build", tone: "text-positive" },
  old_website: { label: "Improve", tone: "text-warning" },
  has_website: { label: "Menu", tone: "text-action" },
};

const CHANNEL_META: Record<string, { label: string; tone: string }> = {
  email: { label: "Email", tone: "text-action" },
  sms: { label: "SMS", tone: "text-positive" },
  dm: { label: "DM", tone: "text-warning" },
  voice_agent: { label: "Voice", tone: "text-ink-muted" },
};

const STATUS_TONE: Record<string, string> = {
  active: "text-positive",
  building: "text-action",
  paused: "text-warning",
  done: "text-ink-muted",
  draft: "text-ink-muted",
};

async function getCampaigns(): Promise<Campaign[]> {
  return safeDb(async (db) => {
    const { data } = await db
      .from("call_campaigns")
      .select("id,name,source,segment,channel,country_code,category,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    return (data ?? []) as Campaign[];
  }, []);
}

async function getMemberCounts(campaignIds: string[]): Promise<Map<string, Counts>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await safeDb(async (db) => {
    const { data } = await db
      .from("campaign_leads")
      .select("campaign_id,status")
      .in("campaign_id", campaignIds)
      .limit(50000);
    return (data ?? []) as CampaignLeadRow[];
  }, [] as CampaignLeadRow[]);

  const acc = new Map<string, { total: number; pending: number; interested: number }>();
  for (const r of rows) {
    const e = acc.get(r.campaign_id) ?? { total: 0, pending: 0, interested: 0 };
    e.total += 1;
    if (r.status === "pending") e.pending += 1;
    if (r.status === "interested") e.interested += 1;
    acc.set(r.campaign_id, e);
  }
  const out = new Map<string, Counts>();
  for (const [id, e] of acc) {
    out.set(id, { total: e.total, contacted: e.total - e.pending, interested: e.interested });
  }
  return out;
}

function successRate(c: Counts): string {
  if (c.contacted <= 0) return "—";
  return `${Math.round((c.interested / c.contacted) * 100)}%`;
}

export default async function CampaignsPage() {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">
          Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load campaigns.
        </p>
      </div>
    );
  }

  const campaigns = await getCampaigns();
  const counts = await getMemberCounts(campaigns.map((c) => c.id));

  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Campaigns"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{campaigns.length}</span>{" "}
            {campaigns.length === 1 ? "campaign" : "campaigns"}
          </>
        }
        actions={<NewCampaignForm />}
      />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Create a campaign to start reaching leads by voice, SMS, DM, or email — it'll only pull leads eligible for the channel you pick."
        />
      ) : (
        <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-alt border-b border-rule">
              <tr>
                <Th>Campaign</Th>
                <Th>Channel</Th>
                <Th>Segment</Th>
                <Th>Country</Th>
                <Th>Category</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Contacted</Th>
                <Th className="text-right">Interested</Th>
                <Th className="text-right">Success</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {campaigns.map((c) => {
                const ct = counts.get(c.id) ?? { total: 0, contacted: 0, interested: 0 };
                const seg = c.segment ? SEGMENT_META[c.segment] : undefined;
                const chan = c.channel ? CHANNEL_META[c.channel] : undefined;
                return (
                  <tr key={c.id} className="hover:bg-surface-alt transition-colors">
                    <td className="px-4 py-2.5">
                      <Link href={`/campaigns/${c.id}`} className="text-[14px] font-semibold text-ink hover:text-action">
                        {c.name}
                      </Link>
                      <div className="text-[11px] text-ink-subtle mono-num uppercase">{c.source}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      {chan ? (
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-alt ${chan.tone}`}>
                          {chan.label}
                        </span>
                      ) : (
                        <span className="text-ink-subtle text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {seg ? (
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-surface-alt ${seg.tone}`}>
                          {seg.label}
                        </span>
                      ) : (
                        <span className="text-ink-subtle text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted uppercase">
                      {c.country_code ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-ink-muted capitalize">
                      {c.category ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-ink text-right">{ct.total}</td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted text-right">{ct.contacted}</td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-positive font-semibold text-right">{ct.interested}</td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-ink text-right">{successRate(ct)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-surface-alt capitalize ${STATUS_TONE[c.status] ?? "text-ink-muted"}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
