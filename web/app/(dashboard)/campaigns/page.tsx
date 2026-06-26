/**
 * (dashboard)/campaigns/page.tsx — Campaign list (table).
 *
 * Inputs:  call_campaigns + campaign_leads via safeDb
 * Outputs: a table — name | segment | country | category | leads | contacted | interested | success% | status
 * Used by: route "/campaigns"
 *
 * "Contacted" = members no longer `pending` (sent at least once). "Interested" = positive
 * engagement outcomes. Success rate = interested / contacted. All computed from
 * campaign_leads.status counts (no extra query).
 */

import { unstable_cache } from "next/cache";
import { Megaphone } from "lucide-react";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { NewCampaignForm } from "@/components/NewCampaignForm";
import { CampaignsTable } from "@/components/CampaignsTable";
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

// Returns a plain object (not a Map) so the result can be cached via
// unstable_cache, which serializes return values as JSON.
async function getMemberCounts(campaignIds: string[]): Promise<Record<string, Counts>> {
  if (campaignIds.length === 0) return {};
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
  const out: Record<string, Counts> = {};
  for (const [id, e] of acc) {
    out[id] = { total: e.total, contacted: e.total - e.pending, interested: e.interested };
  }
  return out;
}

// Cache the list + member-count rollup for a short window so repeat visits are
// instant. Tagged "campaigns" so creating a campaign can bust it immediately.
const cachedGetCampaigns = unstable_cache(getCampaigns, ["campaigns-list"], {
  revalidate: 20,
  tags: ["campaigns"],
});
const cachedMemberCounts = unstable_cache(getMemberCounts, ["campaign-member-counts"], {
  revalidate: 20,
  tags: ["campaigns"],
});

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

  const campaigns = await cachedGetCampaigns();
  const counts = await cachedMemberCounts(campaigns.map((c) => c.id));

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
          description="Create a campaign to start reaching leads by SMS, DM, or email — it'll only pull leads eligible for the channel you pick."
        />
      ) : (
        <>
          <p className="mb-2 text-[11px] text-ink-subtle">Drag a column header to reorder · the header stays put as you scroll.</p>
          <CampaignsTable
            rows={campaigns.map((c) => {
              const ct = counts[c.id] ?? { total: 0, contacted: 0, interested: 0 };
              return {
                id: c.id,
                name: c.name,
                source: c.source,
                channel: c.channel,
                segment: c.segment,
                country_code: c.country_code,
                category: c.category,
                status: c.status,
                total: ct.total,
                contacted: ct.contacted,
                interested: ct.interested,
              };
            })}
          />
        </>
      )}
    </div>
  );
}
