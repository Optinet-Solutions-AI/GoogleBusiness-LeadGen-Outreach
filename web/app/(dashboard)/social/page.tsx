/**
 * (dashboard)/social/page.tsx — Social DM worklist.
 *
 * Inputs:  social-only leads (website_kind ∈ social) + dm_sent events + the
 *          dedicated social_accounts the team DMs from.
 * Outputs: a worklist — each lead with platform, DM-sent status, and inline
 *          copy-message / open-profile / mark-sent (compliant assisted DM).
 * Used by: SideNav → /social
 *
 * Meta blocks automated cold DMs, so this is operator-assisted: pick a lead,
 * copy the message, open the profile (logged into the shared account), send by
 * hand, mark sent. The dedicated account is shown so everyone DMs from the same one.
 */

import { Share2 } from "lucide-react";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { SOCIAL_KINDS } from "@/lib/campaigns/eligibility";
import { socialLabel } from "@/lib/social";
import { SocialDmRow, type SocialLead } from "@/components/SocialDmRow";
import { ConnectSocialButton } from "@/components/ConnectSocialButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { countryLabel } from "@/lib/data/cities";
import type { DmOffer } from "@/lib/dm-message";

export const dynamic = "force-dynamic";

interface RawLead {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  website_url: string | null;
  website_kind: string | null;
  primary_offer: DmOffer;
}

interface SocialAccount {
  platform: string;
  handle: string;
  profile_url: string | null;
  label: string | null;
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

export default async function SocialPage() {
  if (!isDbConfigured()) {
    return (
      <EmptyState
        icon={Share2}
        title="Supabase not configured"
        description="Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load social leads."
      />
    );
  }

  const [rawLeads, accounts] = await Promise.all([
    safeDb<RawLead[]>(async (db) => {
      const { data } = await db
        .from("leads")
        .select("id,business_name,address,country_code,category,website_url,website_kind,primary_offer")
        .in("website_kind", SOCIAL_KINDS)
        .neq("qualified", false)
        .order("updated_at", { ascending: false })
        .limit(200);
      return (data ?? []) as RawLead[];
    }, []),
    safeDb<SocialAccount[]>(async (db) => {
      const { data } = await db
        .from("social_accounts")
        .select("platform,handle,profile_url,label")
        .eq("status", "active")
        .order("created_at", { ascending: true });
      return (data ?? []) as SocialAccount[];
    }, []),
  ]);

  // Which of these leads already have a DM logged.
  const sentIds = await safeDb<Set<string>>(async (db) => {
    if (rawLeads.length === 0) return new Set<string>();
    const { data } = await db
      .from("outreach_events")
      .select("lead_id")
      .eq("kind", "dm_sent")
      .in("lead_id", rawLeads.map((l) => l.id))
      .limit(5000);
    return new Set((data ?? []).map((r: { lead_id: string }) => r.lead_id));
  }, new Set<string>());

  const leads: SocialLead[] = rawLeads.map((l) => ({
    id: l.id,
    business_name: l.business_name,
    place:
      [cityFromAddress(l.address), countryLabel(l.country_code)].filter(Boolean).join(" · ") ||
      l.category ||
      "—",
    profile_url: l.website_url,
    platform_label: socialLabel(l.website_kind),
    primary_offer: l.primary_offer,
  }));
  const pending = leads.filter((l) => !sentIds.has(l.id)).length;

  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Social DM"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
            social {leads.length === 1 ? "lead" : "leads"} ·{" "}
            <span className="mono-num text-ink font-semibold">{pending}</span> to DM
          </>
        }
        actions={<ConnectSocialButton />}
      />

      {/* Dedicated account(s) the team DMs from */}
      <div className="mb-6 rounded-lg border border-rule bg-surface px-4 py-3 text-[12.5px]">
        {accounts.length === 0 ? (
          <span className="text-ink-muted">
            No dedicated DM account set yet — add the shared handle your team sends from so everyone
            DMs from the same account.
          </span>
        ) : (
          <span className="text-ink-muted">
            DM from:{" "}
            {accounts.map((a, i) => (
              <span key={a.handle} className="text-ink font-medium">
                {i > 0 ? ", " : ""}
                {a.profile_url ? (
                  <a href={a.profile_url} target="_blank" rel="noreferrer" className="hover:underline">
                    {a.handle}
                  </a>
                ) : (
                  a.handle
                )}
                <span className="text-ink-subtle font-normal"> ({a.platform})</span>
              </span>
            ))}
          </span>
        )}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="No social leads yet"
          description="Leads scraped with a Facebook/Instagram page (and no website) show up here to DM. Run a batch to pull some in."
        />
      ) : (
        <ul className="bg-surface border border-rule rounded-lg divide-y divide-rule overflow-hidden">
          {leads.map((lead) => (
            <SocialDmRow key={lead.id} lead={lead} initialSent={sentIds.has(lead.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
