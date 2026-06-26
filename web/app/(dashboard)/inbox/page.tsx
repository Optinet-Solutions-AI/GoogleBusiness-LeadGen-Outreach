/**
 * (dashboard)/inbox/page.tsx — Conversation inbox.
 *
 * Inputs:  warm leads (email replied / form submitted / needs_reply)
 *          + the latest email_messages row per lead (for the conversation snippet)
 * Outputs: a conversation list — each row shows the last message + signal and
 *          opens the full thread at /inbox/[id].
 * Used by: SideNav → /inbox
 *
 * "Sync replies" pulls inbound email from connected mailboxes (POST /api/email/sync).
 */

import Link from "next/link";
import { ChevronRight, Inbox, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SyncRepliesButton } from "@/components/SyncRepliesButton";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";
import { countryLabel } from "@/lib/data/cities";

export const dynamic = "force-dynamic";

type Offer = "build_website" | "improve_website" | "voice_agent";

interface Lead {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  phone: string | null;
  stage: string;
  call_segment: string | null;
  primary_offer: Offer | null;
  needs_improvement: boolean | null;
  website_score: number | null;
  website_kind: WebsiteKind | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  category_off_niche: boolean | null;
  updated_at: string;
}

type Reason = "replied" | "form";
type InboxLead = Lead & { reason: Reason };

interface LastMessage {
  direction: "outbound" | "inbound";
  subject: string | null;
  snippet: string;
  created_at: string;
}

const SELECT =
  "id,business_name,address,country_code,category,phone,stage," +
  "call_segment,primary_offer,needs_improvement,website_score," +
  "website_kind,business_status,is_service_area_only,is_franchise_flagged," +
  "category_off_niche,updated_at";

async function getInboxLeads(): Promise<InboxLead[]> {
  if (!isDbConfigured()) return [];

  return safeDb(async (db) => {
    // Two sources: email replies (stage=replied) and form submissions (inbox_status open/needs_reply).
    const [repliedResult, formResult] = await Promise.all([
      db.from("leads").select(SELECT).eq("stage", "replied").order("updated_at", { ascending: false }).limit(500),
      db.from("leads").select(SELECT).in("inbox_status", ["open", "needs_reply"]).order("updated_at", { ascending: false }).limit(500),
    ]);

    // replied wins if a lead appears in both (most advanced state).
    const merged = new Map<string, InboxLead>();
    for (const lead of (formResult.data ?? []) as unknown as Lead[]) merged.set(lead.id, { ...lead, reason: "form" });
    for (const lead of (repliedResult.data ?? []) as unknown as Lead[]) merged.set(lead.id, { ...lead, reason: "replied" });

    return [...merged.values()].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, []);
}

async function getLatestMessages(leadIds: string[]): Promise<Map<string, LastMessage>> {
  if (leadIds.length === 0) return new Map();
  return safeDb(async (db) => {
    const { data } = await db
      .from("email_messages")
      .select("lead_id,direction,subject,body_snippet,created_at")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false })
      .limit(3000);
    const map = new Map<string, LastMessage>();
    for (const r of (data ?? []) as {
      lead_id: string;
      direction: "outbound" | "inbound";
      subject: string | null;
      body_snippet: string | null;
      created_at: string;
    }[]) {
      if (!map.has(r.lead_id)) {
        map.set(r.lead_id, {
          direction: r.direction,
          subject: r.subject,
          snippet: r.body_snippet ?? "",
          created_at: r.created_at,
        });
      }
    }
    return map;
  }, new Map<string, LastMessage>());
}

/** Most-recent campaign each lead belongs to (for grouping the inbox). */
async function getLeadCampaigns(
  leadIds: string[],
): Promise<Map<string, { id: string; name: string }>> {
  if (leadIds.length === 0) return new Map();
  return safeDb(async (db) => {
    const { data } = await db
      .from("campaign_leads")
      .select("lead_id, added_at, call_campaigns(id,name)")
      .in("lead_id", leadIds)
      .order("added_at", { ascending: false });
    const map = new Map<string, { id: string; name: string }>();
    for (const r of (data ?? []) as unknown as {
      lead_id: string;
      call_campaigns: { id: string; name: string } | null;
    }[]) {
      if (r.call_campaigns && !map.has(r.lead_id)) {
        map.set(r.lead_id, { id: r.call_campaigns.id, name: r.call_campaigns.name });
      }
    }
    return map;
  }, new Map<string, { id: string; name: string }>());
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function SignalChip({ reason, hasReply }: { reason: Reason; hasReply: boolean }) {
  if (hasReply) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-positive text-white">
        Email reply
      </span>
    );
  }
  if (reason === "form") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-positive text-white">
        Form in
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-surface-alt text-ink-muted">
      Replied
    </span>
  );
}

function ThreadRow({ lead, msg }: { lead: InboxLead; msg: LastMessage | undefined }) {
  const hasReply = msg?.direction === "inbound";
  const place =
    [cityFromAddress(lead.address), countryLabel(lead.country_code)].filter(Boolean).join(" · ") ||
    lead.category ||
    "—";
  return (
    <Link
      href={`/inbox/${lead.id}`}
      className="group flex items-start gap-3.5 px-4 py-3.5 hover:bg-surface-alt transition-colors"
    >
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-ink text-canvas font-display font-semibold text-[13px] leading-none">
        {lead.business_name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-semibold text-ink truncate">{lead.business_name}</span>
          <span className="mono-num text-[11px] text-ink-subtle flex-none">
            {relativeTime(msg?.created_at ?? lead.updated_at)}
          </span>
        </div>
        {msg ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-muted truncate">
            {hasReply ? (
              <ArrowDownLeft className="h-3.5 w-3.5 text-positive flex-none" strokeWidth={2} />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5 text-ink-subtle flex-none" strokeWidth={2} />
            )}
            <span className="truncate">{msg.snippet || msg.subject || "(no preview)"}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-[12.5px] text-ink-subtle truncate">{place}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <SignalChip reason={lead.reason} hasReply={hasReply} />
          <LeadBadges lead={lead} />
        </div>
      </div>
      <ChevronRight
        className="mt-2 h-4 w-4 flex-none text-ink-subtle group-hover:text-ink group-hover:translate-x-0.5 transition-all"
        strokeWidth={1.75}
      />
    </Link>
  );
}

interface InboxGroup {
  id: string | null;
  name: string;
  leads: InboxLead[];
}

/** Group threads by their most-recent campaign; campaigns first (by latest
 *  activity), "Unassigned" last. */
function groupByCampaign(
  leads: InboxLead[],
  campaigns: Map<string, { id: string; name: string }>,
): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const lead of leads) {
    const c = campaigns.get(lead.id);
    const key = c?.id ?? "__none__";
    if (!groups.has(key)) groups.set(key, { id: c?.id ?? null, name: c?.name ?? "Unassigned", leads: [] });
    groups.get(key)!.leads.push(lead);
  }
  // `leads` arrives sorted by updated_at desc, so each group's first lead is its
  // freshest. Order groups by that; Unassigned always last.
  return [...groups.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return (b.leads[0]?.updated_at ?? "").localeCompare(a.leads[0]?.updated_at ?? "");
  });
}

export default async function InboxPage() {
  const leads = await getInboxLeads();
  const messages = await getLatestMessages(leads.map((l) => l.id));
  const campaigns = await getLeadCampaigns(leads.map((l) => l.id));
  const groups = groupByCampaign(leads, campaigns);

  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Inbox"
        subtitle={
          <>
            Conversations to work — email replies &amp; submitted forms.{" "}
            <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
            {leads.length === 1 ? "thread" : "threads"}.
          </>
        }
        actions={<SyncRepliesButton />}
      />

      {leads.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting"
          description="When a lead replies to your email or someone submits an intake form, the conversation shows up here."
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.id ?? "__none__"}>
              <div className="flex items-baseline gap-2 mb-1.5 px-1">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] font-mono text-ink-muted">
                  {group.name}
                </h2>
                <span className="mono-num text-[11px] text-ink-subtle">
                  {group.leads.length} {group.leads.length === 1 ? "thread" : "threads"}
                </span>
              </div>
              <div className="bg-surface border border-rule rounded-lg divide-y divide-rule overflow-hidden">
                {group.leads.map((lead) => (
                  <ThreadRow key={lead.id} lead={lead} msg={messages.get(lead.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
