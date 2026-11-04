"use client";

/**
 * crm/CrmCardView.tsx — one draggable lead card on the CRM board.
 *
 * Inputs:  card, now (for the follow-up badge), drag handlers, onOpen
 * Outputs: a compact card: name, city, offer, follow-up badge, tags, owner, status glyphs
 * Used by: components/crm/CrmBoard.tsx
 */
import type { DragEvent } from "react";
import { Mail, Phone, Globe, MessageSquareText, PhoneCall, CalendarClock, User } from "lucide-react";
import { cx } from "@/lib/cx";
import { followUpBucket, type CrmCard } from "@/lib/crm/board";

const OFFER_SHORT: Record<string, string> = {
  build_website: "Build site",
  improve_website: "Improve site",
  voice_agent: "AI services",
  buy_inventory: "Buy inventory",
};

function city(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || null;
}

function dueLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function CrmCardView({
  card,
  now,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: CrmCard;
  now: Date;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const bucket = followUpBucket(card.next_follow_up_at, now);
  const dueTone =
    bucket === "overdue" ? "bg-urgent-soft text-urgent" : bucket === "today" ? "bg-warning-soft text-warning" : bucket === "week" ? "bg-action-soft text-action" : "bg-surface-alt text-ink-muted";
  const place = city(card.address);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cx(
        "group cursor-grab active:cursor-grabbing rounded-lg border border-rule bg-surface p-2.5 shadow-card hover:border-rule-strong transition",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{card.business_name}</div>
          <div className="truncate text-[11px] text-ink-muted">
            {[place, card.category].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        {card.primary_offer && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-surface-alt text-ink-muted">
            {OFFER_SHORT[card.primary_offer] ?? card.primary_offer}
          </span>
        )}
      </div>

      {(card.next_follow_up_at || card.tags.length > 0 || card.assigned_to) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {card.next_follow_up_at && (
            <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", dueTone)}>
              <CalendarClock className="h-3 w-3" /> {bucket === "today" ? "Today" : dueLabel(card.next_follow_up_at, now)}
            </span>
          )}
          {card.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded px-1.5 py-0.5 text-[10px] bg-action-soft text-action">
              {t}
            </span>
          ))}
          {card.assigned_to && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-ink-muted">
              <User className="h-3 w-3" /> {card.assigned_to}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-ink-subtle">
        <Mail className={cx("h-3.5 w-3.5", card.email ? "text-ink-muted" : "opacity-30")} aria-label={card.email ? "Has email" : "No email"} />
        <Phone className={cx("h-3.5 w-3.5", card.phone ? "text-ink-muted" : "opacity-30")} aria-label={card.phone ? "Has phone" : "No phone"} />
        <Globe className={cx("h-3.5 w-3.5", card.demo_url ? "text-ink-muted" : "opacity-30")} aria-label={card.demo_url ? "Demo site live" : "No demo site"} />
        {card.inbox_status === "needs_reply" && <MessageSquareText className="h-3.5 w-3.5 text-urgent" aria-label="Needs a reply" />}
        {card.seq_status === "active" && <span className="text-[10px] font-semibold text-action">seq</span>}
        {card.call_status && card.call_status !== "none" && <PhoneCall className="h-3.5 w-3.5 text-ink-muted" aria-label={`Call: ${card.call_status}`} />}
        {card.monthly_amount ? <span className="ml-auto mono-num text-[11px] font-semibold text-positive">${card.monthly_amount}/mo</span> : null}
      </div>
    </div>
  );
}
