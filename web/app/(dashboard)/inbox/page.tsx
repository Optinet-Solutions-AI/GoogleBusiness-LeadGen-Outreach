/**
 * (dashboard)/inbox/page.tsx — Gmail-style conversation inbox (server shell).
 *
 * Inputs:  the "inbox universe" of leads — replied / open / needs_reply / closed
 *          / snoozed / starred / dnc / unsubscribed — plus each one's latest
 *          email_messages snippet and most-recent campaign.
 * Outputs: maps the rows to InboxThread[] and renders <InboxClient/>, which owns
 *          all interactivity (filters, search, selection, reading pane, actions).
 * Used by: SideNav → /inbox
 */

import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { InboxClient, type InboxThread } from "@/components/inbox/InboxClient";
import { countryLabel } from "@/lib/data/cities";

export const dynamic = "force-dynamic";

interface LeadRow {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  call_segment: string | null;
  primary_offer: "build_website" | "improve_website" | "voice_agent" | null;
  needs_improvement: boolean | null;
  website_score: number | null;
  website_kind: string | null;
  website_url: string | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  category_off_niche: boolean | null;
  updated_at: string;
  is_favorite: boolean | null;
  inbox_read_at: string | null;
  inbox_status: string | null;
  lifecycle_stage: string | null;
}

const SELECT =
  "id,business_name,address,country_code,category,phone,email,stage,call_segment," +
  "primary_offer,needs_improvement,website_score,website_kind,website_url,business_status," +
  "is_service_area_only,is_franchise_flagged,category_off_niche,updated_at," +
  "is_favorite,inbox_read_at,inbox_status,lifecycle_stage";

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

async function getThreads(): Promise<InboxThread[]> {
  if (!isDbConfigured()) return [];

  return safeDb(async (db) => {
    // One query for the whole inbox universe; the client splits it into views.
    const { data: leadsData } = await db
      .from("leads")
      .select(SELECT)
      .or(
        "stage.eq.replied," +
          "inbox_status.in.(open,needs_reply,closed,snoozed)," +
          "is_favorite.eq.true," +
          "lifecycle_stage.in.(dnc,unsubscribed)",
      )
      .order("updated_at", { ascending: false })
      .limit(800);

    const leads = (leadsData ?? []) as unknown as LeadRow[];
    if (leads.length === 0) return [];
    const ids = leads.map((l) => l.id);

    const [msgRes, campRes] = await Promise.all([
      db
        .from("email_messages")
        .select("lead_id,direction,subject,body_snippet,created_at")
        .in("lead_id", ids)
        .order("created_at", { ascending: false })
        .limit(5000),
      db
        .from("campaign_leads")
        .select("lead_id,added_at,call_campaigns(id,name)")
        .in("lead_id", ids)
        .order("added_at", { ascending: false }),
    ]);

    const lastMsg = new Map<
      string,
      { direction: "inbound" | "outbound"; subject: string | null; snippet: string; at: string }
    >();
    for (const r of (msgRes.data ?? []) as {
      lead_id: string;
      direction: "inbound" | "outbound";
      subject: string | null;
      body_snippet: string | null;
      created_at: string;
    }[]) {
      if (!lastMsg.has(r.lead_id)) {
        lastMsg.set(r.lead_id, {
          direction: r.direction,
          subject: r.subject,
          snippet: r.body_snippet ?? "",
          at: r.created_at,
        });
      }
    }

    const camp = new Map<string, { id: string; name: string }>();
    for (const r of (campRes.data ?? []) as unknown as {
      lead_id: string;
      call_campaigns: { id: string; name: string } | null;
    }[]) {
      if (r.call_campaigns && !camp.has(r.lead_id)) {
        camp.set(r.lead_id, { id: r.call_campaigns.id, name: r.call_campaigns.name });
      }
    }

    return leads.map((l): InboxThread => {
      const last = lastMsg.get(l.id) ?? null;
      const place =
        [cityFromAddress(l.address), countryLabel(l.country_code)].filter(Boolean).join(" · ") ||
        l.category ||
        "—";
      return {
        id: l.id,
        business_name: l.business_name,
        email: l.email,
        place,
        campaign: camp.get(l.id) ?? null,
        last,
        unread: !l.inbox_read_at,
        isFavorite: !!l.is_favorite,
        inboxStatus: l.inbox_status,
        lifecycleStage: l.lifecycle_stage,
        reason: l.stage === "replied" ? "replied" : "form",
        updatedAt: l.updated_at,
        badge: {
          website_kind: l.website_kind as InboxThread["badge"]["website_kind"],
          website_url: l.website_url,
          business_status: l.business_status,
          is_service_area_only: l.is_service_area_only,
          is_franchise_flagged: l.is_franchise_flagged,
          category_off_niche: l.category_off_niche,
          primary_offer: l.primary_offer,
          needs_improvement: l.needs_improvement,
          website_score: l.website_score,
          call_segment: l.call_segment,
        },
      };
    });
  }, []);
}

export default async function InboxPage() {
  const threads = await getThreads();
  return <InboxClient initialThreads={threads} />;
}
