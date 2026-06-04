/**
 * (dashboard)/inbox/page.tsx — Conversation inbox.
 *
 * Inputs:  warm leads (interested call / replied / submitted form / needs_reply)
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
  call_status: string | null;
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

type Reason = "interested" | "replied" | "form";
type InboxLead = Lead & { reason: Reason };

interface LastMessage {
  direction: "outbound" | "inbound";
  subject: string | null;
  snippet: string;
  created_at: string;
}

const SELECT =
  "id,business_name,address,country_code,category,phone,stage," +
  "call_status,call_segment,primary_offer,needs_improvement,website_score," +
  "website_kind,business_status,is_service_area_only,is_franchise_flagged," +
  "category_off_niche,updated_at";

async function getInboxLeads(): Promise<InboxLead[]> {
  if (!isDbConfigured()) return [];

  return safeDb(async (db) => {
    const { data: interestedAttempts } = await db
      .from("call_attempts")
      .select("lead_id")
      .eq("outcome", "interested")
      .limit(5000);

    const interestedIds = new Set(
      (interestedAttempts ?? []).map((r: { lead_id: string }) => r.lead_id),
    );

    const [interestedResult, repliedResult, formResult] = await Promise.all([
      interestedIds.size > 0
        ? db.from("leads").select(SELECT).in("id", [...interestedIds]).order("updated_at", { ascending: false }).limit(500)
        : Promise.resolve({ data: [] }),
      db.from("leads").select(SELECT).eq("stage", "replied").order("updated_at", { ascending: false }).limit(500),
      db.from("leads").select(SELECT).in("inbox_status", ["open", "needs_reply"]).order("updated_at", { ascending: false }).limit(500),
    ]);

    const merged = new Map<string, InboxLead>();
    for (const lead of (repliedResult.data ?? []) as unknown as Lead[]) merged.set(lead.id, { ...lead, reason: "replied" });
    for (const lead of (interestedResult.data ?? []) as unknown as Lead[]) merged.set(lead.id, { ...lead, reason: "interested" });
    for (const lead of (formResult.data ?? []) as unknown as Lead[]) merged.set(lead.id, { ...lead, reason: "form" });

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
  if (reason === "interested") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-positive-soft text-positive">
        Interested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-surface-alt text-ink-muted">
      Replied
    </span>
  );
}

export default async function InboxPage() {
  const leads = await getInboxLeads();
  const messages = await getLatestMessages(leads.map((l) => l.id));

  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Inbox"
        subtitle={
          <>
            Conversations to work — interested calls, replies &amp; submitted forms.{" "}
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
          description="When a call is marked interested, a lead replies to your email, or someone submits an intake form, the conversation shows up here."
        />
      ) : (
        <section className="bg-surface border border-rule rounded-lg divide-y divide-rule overflow-hidden">
          {leads.map((lead) => {
            const msg = messages.get(lead.id);
            const hasReply = msg?.direction === "inbound";
            const place =
              [cityFromAddress(lead.address), countryLabel(lead.country_code)].filter(Boolean).join(" · ") ||
              lead.category ||
              "—";
            return (
              <Link
                key={lead.id}
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
          })}
        </section>
      )}
    </div>
  );
}
