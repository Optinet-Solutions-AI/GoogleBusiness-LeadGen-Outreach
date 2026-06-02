/**
 * (dashboard)/campaigns/page.tsx — Campaign list.
 *
 * Inputs:  call_campaigns + campaign_leads tables via safeDb
 * Outputs: grid of CampaignCard components, one per campaign
 * Used by: route "/campaigns"
 */

import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { CampaignCard } from "@/components/CampaignCard";
import { NewCampaignForm } from "@/components/NewCampaignForm";

export const dynamic = "force-dynamic";

interface Campaign {
  id: string;
  name: string;
  source: string;
  segment: string | null;
  country_code: string | null;
  category: string | null;
  batch_id: string | null;
  target_count: number | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
  timezone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CampaignLeadRow {
  campaign_id: string;
  status: string;
}

interface CampaignCounts {
  total: number;
  called: number;
  interested: number;
}

const CALLED_STATUSES = new Set(["called", "interested", "not_interested", "voicemail", "no_answer", "done"]);

async function getCampaigns(): Promise<Campaign[]> {
  return safeDb(async (db) => {
    const { data } = await db
      .from("call_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return (data ?? []) as Campaign[];
  }, []);
}

async function getMemberCounts(campaignIds: string[]): Promise<Map<string, CampaignCounts>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await safeDb(async (db) => {
    const { data } = await db
      .from("campaign_leads")
      .select("campaign_id,status")
      .in("campaign_id", campaignIds)
      .limit(50000);
    return (data ?? []) as CampaignLeadRow[];
  }, [] as CampaignLeadRow[]);

  const map = new Map<string, CampaignCounts>();
  for (const r of rows) {
    const entry = map.get(r.campaign_id) ?? { total: 0, called: 0, interested: 0 };
    entry.total += 1;
    if (CALLED_STATUSES.has(r.status)) entry.called += 1;
    if (r.status === "interested") entry.interested += 1;
    map.set(r.campaign_id, entry);
  }
  return map;
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
      <header className="flex items-end justify-between mb-6 gap-4">
        <div>
          <p className="eyebrow mb-2">Outreach</p>
          <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">
            Campaigns
          </h1>
          <p className="text-[13px] text-ink-muted mt-2">
            <span className="mono-num text-ink font-semibold">{campaigns.length}</span>{" "}
            {campaigns.length === 1 ? "campaign" : "campaigns"}
          </p>
        </div>
        <NewCampaignForm />
      </header>

      {campaigns.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg p-12 text-center">
          <p className="text-[13px] text-ink-muted">
            No campaigns yet — create one to start calling.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              counts={counts.get(c.id) ?? { total: 0, called: 0, interested: 0 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
