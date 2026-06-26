"use client";

/**
 * InboxClient.tsx — Gmail-style inbox shell (list + reading pane).
 *
 * Inputs:  initialThreads (mapped server-side from the inbox universe)
 * Outputs: filters (All/Unread/Starred/Needs reply/Done/DNC) + campaign filter +
 *          search + multi-select bulk actions + a reading pane. All mutations go
 *          through POST /api/inbox/actions with optimistic local updates.
 * Used by: app/(dashboard)/inbox/page.tsx
 *
 * One thread per lead. Unread = no inbox_read_at (shown bold). Archive reuses
 * inbox_status='closed'; DNC reuses lifecycle_stage='dnc'.
 */

import { useMemo, useState, useCallback } from "react";
import { Search, Star, Archive, Ban, MailOpen, Mail, Inbox as InboxIcon, ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { SyncRepliesButton } from "@/components/SyncRepliesButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReadingPane } from "@/components/inbox/ReadingPane";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { relativeTime } from "@/lib/format";

export interface InboxThread {
  id: string;
  business_name: string;
  email: string | null;
  place: string;
  campaign: { id: string; name: string } | null;
  last: { direction: "inbound" | "outbound"; subject: string | null; snippet: string; at: string } | null;
  unread: boolean;
  isFavorite: boolean;
  inboxStatus: string | null;
  lifecycleStage: string | null;
  reason: "replied" | "form";
  updatedAt: string;
  badge: {
    website_kind?: WebsiteKind | null;
    website_url?: string | null;
    business_status?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
    is_service_area_only?: boolean | null;
    is_franchise_flagged?: boolean | null;
    category_off_niche?: boolean | null;
    primary_offer?: "build_website" | "improve_website" | "voice_agent" | null;
    needs_improvement?: boolean | null;
    website_score?: number | null;
    call_segment?: string | null;
  };
}

/** Optimistic field patch applied to a thread row after an action. */
export type ThreadMutation = Partial<
  Pick<InboxThread, "unread" | "isFavorite" | "inboxStatus" | "lifecycleStage">
>;

type Filter = "all" | "unread" | "starred" | "needs_reply" | "done" | "dnc";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "starred", label: "Starred" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "done", label: "Done" },
  { key: "dnc", label: "Do not contact" },
];

function isDnc(t: InboxThread): boolean {
  return t.lifecycleStage === "dnc" || t.lifecycleStage === "unsubscribed";
}
function isArchived(t: InboxThread): boolean {
  return t.inboxStatus === "closed";
}
function matchesFilter(t: InboxThread, f: Filter): boolean {
  switch (f) {
    case "all":
      return !isArchived(t) && !isDnc(t);
    case "unread":
      return t.unread && !isArchived(t) && !isDnc(t);
    case "starred":
      return t.isFavorite && !isDnc(t);
    case "needs_reply":
      return !isArchived(t) && !isDnc(t) && (t.inboxStatus === "needs_reply" || t.last?.direction === "inbound");
    case "done":
      return isArchived(t) && !isDnc(t);
    case "dnc":
      return isDnc(t);
  }
}

export function InboxClient({ initialThreads }: { initialThreads: InboxThread[] }) {
  const [threads, setThreads] = useState<InboxThread[]>(initialThreads);
  const [filter, setFilter] = useState<Filter>("all");
  const [campaignId, setCampaignId] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const mutate = useCallback((id: string, patch: ThreadMutation) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Distinct campaigns present (for the campaign filter dropdown).
  const campaigns = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of threads) if (t.campaign) m.set(t.campaign.id, t.campaign.name);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [threads]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads
      .filter((t) => matchesFilter(t, filter))
      .filter((t) => campaignId === "__all__" || (t.campaign?.id ?? "__none__") === campaignId)
      .filter((t) => {
        if (!q) return true;
        return (
          t.business_name.toLowerCase().includes(q) ||
          (t.email ?? "").toLowerCase().includes(q) ||
          (t.last?.snippet ?? "").toLowerCase().includes(q) ||
          (t.last?.subject ?? "").toLowerCase().includes(q) ||
          t.place.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.last?.at ?? b.updatedAt).localeCompare(a.last?.at ?? a.updatedAt));
  }, [threads, filter, campaignId, search]);

  const unreadCount = useMemo(
    () => threads.filter((t) => t.unread && !isArchived(t) && !isDnc(t)).length,
    [threads],
  );

  // ── bulk actions ──────────────────────────────────────────────────────────
  const allChecked = visible.length > 0 && visible.every((t) => checked.has(t.id));
  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(visible.map((t) => t.id)));
  }
  function toggleOne(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function bulk(body: Record<string, unknown>, patch: ThreadMutation, label: string) {
    const ids = [...checked];
    if (ids.length === 0) return;
    if (body.dnc && !confirm(`Mark ${ids.length} lead(s) Do-Not-Contact? Stops their sequences and suppresses all future sends.`)) return;
    setThreads((prev) => prev.map((t) => (checked.has(t.id) ? { ...t, ...patch } : t)));
    setChecked(new Set());
    const res = await fetchJson<{ updated: number }>("/api/inbox/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: ids, ...body }),
    });
    if (!res.success) toast.error(res.error, { title: "Bulk action failed" });
    else toast.success(`${label} · ${ids.length}`);
  }

  // single-row star toggle (no need to open the thread)
  async function toggleStar(t: InboxThread) {
    mutate(t.id, { isFavorite: !t.isFavorite });
    const res = await fetchJson<{ updated: number }>("/api/inbox/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: [t.id], is_favorite: !t.isFavorite }),
    });
    if (!res.success) {
      mutate(t.id, { isFavorite: t.isFavorite }); // revert
      toast.error(res.error, { title: "Couldn't star" });
    }
  }

  function openThread(id: string) {
    setSelectedId(id);
    mutate(id, { unread: false }); // optimistic; the thread GET also marks read
  }

  const selected = selectedId ? threads.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business, email, or message…"
            className="h-9 w-full rounded-lg border border-rule-strong pl-9 pr-3 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-subtle hover:text-ink">
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="h-9 max-w-[40%] truncate rounded-lg border border-rule-strong bg-white px-2 text-[12.5px] text-ink-muted outline-none focus:border-action focus:ring-2 focus:ring-action/20"
        >
          <option value="__all__">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="__none__">Unassigned</option>
        </select>
        <SyncRepliesButton />
      </div>

      {/* Filter chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count =
            f.key === "unread" ? unreadCount : threads.filter((t) => matchesFilter(t, f.key)).length;
          return (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setChecked(new Set()); }}
              className={[
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                active ? "bg-ink text-canvas" : "bg-surface-alt text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {f.label}
              {count > 0 && (
                <span className={`ml-1.5 mono-num text-[11px] ${active ? "text-canvas/70" : "text-ink-subtle"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Two-pane */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* List */}
        <div className={`flex min-h-0 flex-col rounded-lg border border-rule bg-surface ${selectedId ? "hidden lg:flex lg:w-[40%] lg:flex-none" : "flex-1"}`}>
          {/* Bulk toolbar / select-all */}
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="cursor-pointer" aria-label="Select all" />
            {checked.size > 0 ? (
              <div className="flex items-center gap-1">
                <span className="mono-num text-[12px] font-semibold text-ink">{checked.size}</span>
                <span className="text-[12px] text-ink-muted">selected</span>
                <Sep />
                <TbBtn title="Mark read" onClick={() => bulk({ read: true }, { unread: false }, "Marked read")}><MailOpen className="h-3.5 w-3.5" /></TbBtn>
                <TbBtn title="Star" onClick={() => bulk({ is_favorite: true }, { isFavorite: true }, "Starred")}><Star className="h-3.5 w-3.5" /></TbBtn>
                <TbBtn title="Archive" onClick={() => bulk({ archive: true }, { inboxStatus: "closed" }, "Archived")}><Archive className="h-3.5 w-3.5" /></TbBtn>
                <TbBtn title="Do not contact" danger onClick={() => bulk({ dnc: true }, { lifecycleStage: "dnc", inboxStatus: "closed" }, "Marked DNC")}><Ban className="h-3.5 w-3.5" /></TbBtn>
                <button onClick={() => setChecked(new Set())} className="ml-1 text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink">Clear</button>
              </div>
            ) : (
              <span className="text-[12px] text-ink-subtle">
                {visible.length} {visible.length === 1 ? "conversation" : "conversations"}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-rule">
            {visible.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={InboxIcon}
                  title={search ? "No matches" : "Nothing here"}
                  description={search ? "Try a different search or filter." : "When a lead replies or submits a form, it shows up here."}
                />
              </div>
            ) : (
              visible.map((t) => (
                <Row
                  key={t.id}
                  t={t}
                  active={t.id === selectedId}
                  checked={checked.has(t.id)}
                  onCheck={() => toggleOne(t.id)}
                  onOpen={() => openThread(t.id)}
                  onStar={() => toggleStar(t)}
                />
              ))
            )}
          </div>
        </div>

        {/* Reading pane */}
        {selectedId && selected ? (
          <div className="fixed inset-0 z-40 bg-canvas lg:static lg:z-auto lg:min-h-0 lg:flex-1 lg:rounded-lg lg:border lg:border-rule">
            <ReadingPane
              key={selectedId}
              leadId={selectedId}
              isFavorite={selected.isFavorite}
              onClose={() => setSelectedId(null)}
              onMutate={mutate}
            />
          </div>
        ) : (
          <div className="hidden min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-rule lg:flex">
            <p className="text-[13px] text-ink-subtle">Select a conversation to read & reply.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  t,
  active,
  checked,
  onCheck,
  onOpen,
  onStar,
}: {
  t: InboxThread;
  active: boolean;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  onStar: () => void;
}) {
  const hasReply = t.last?.direction === "inbound";
  return (
    <div
      className={[
        "group flex items-start gap-2.5 px-3 py-3 transition-colors",
        active ? "bg-surface-alt" : "hover:bg-surface-alt",
        t.unread ? "bg-action-soft/20" : "",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onCheck}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 cursor-pointer"
        aria-label={`Select ${t.business_name}`}
      />
      <button onClick={onStar} className={`mt-0.5 flex-none ${t.isFavorite ? "text-warning" : "text-ink-subtle opacity-0 group-hover:opacity-100"}`} title={t.isFavorite ? "Unstar" : "Star"}>
        <Star className="h-4 w-4" strokeWidth={1.75} fill={t.isFavorite ? "currentColor" : "none"} />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`truncate text-[13.5px] ${t.unread ? "font-bold text-ink" : "font-medium text-ink"}`}>
            {t.business_name}
          </span>
          <span className="mono-num flex-none text-[11px] text-ink-subtle">
            {relativeTime(t.last?.at ?? t.updatedAt)}
          </span>
        </div>
        {t.last ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-ink-muted">
            {hasReply ? (
              <ArrowDownLeft className="h-3.5 w-3.5 flex-none text-positive" strokeWidth={2} />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5 flex-none text-ink-subtle" strokeWidth={2} />
            )}
            <span className="truncate">{t.last.snippet || t.last.subject || "(no preview)"}</span>
          </p>
        ) : (
          <p className="mt-0.5 truncate text-[12px] text-ink-subtle">{t.place}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          {t.campaign && (
            <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
              {t.campaign.name}
            </span>
          )}
          {hasReply && (
            <span className="rounded bg-positive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Reply
            </span>
          )}
          <LeadBadges lead={t.badge} />
        </div>
      </button>
    </div>
  );
}

function TbBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors ${danger ? "text-ink-muted hover:bg-urgent-soft hover:text-urgent" : "text-ink-muted hover:bg-surface hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-rule" aria-hidden />;
}
