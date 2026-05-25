/**
 * NeedsYouCard.tsx — hero card: prioritized list of things needing the operator.
 *
 * Inputs:  counts of replies / needs_email / meetings_booked / active_batches
 * Outputs: white hero card with a 3px indigo left edge, soft drop shadow, and
 *          up to 4 stacked actionable rows. Each row is a Link that routes to
 *          the filtered view; counts are large Sora display numbers.
 * Used by: app/(dashboard)/page.tsx (home mission control)
 *
 * Per the Operator Clinical Light brief: this is the ONE card on the page with
 * a drop shadow (everywhere else is a 1px rule). The indigo left edge marks it
 * as the primary action surface. Live-pulse dot on the most urgent item only.
 */

import Link from "next/link";
import { ArrowUpRight, MessageSquareText, Mail, Calendar, Activity } from "lucide-react";

interface Props {
  replies: number;
  needsEmail: number;
  meetingsBooked: number;
  activeBatches: number;
}

interface Row {
  count: number;
  label: string;
  caption: string;
  href: string;
  icon: typeof MessageSquareText;
  live?: boolean;
}

export function NeedsYouCard({ replies, needsEmail, meetingsBooked, activeBatches }: Props) {
  const rows: Row[] = [
    {
      count: replies,
      label: "Replies to triage",
      caption: "Customer responses waiting on your decision",
      href: "/replies",
      icon: MessageSquareText,
      live: replies > 0,
    },
    {
      count: needsEmail,
      label: "Leads need an email",
      caption: "Add manually or skip — outreach is blocked until you do",
      href: "/leads?stage=needs_email",
      icon: Mail,
    },
    {
      count: meetingsBooked,
      label: "Meetings booked",
      caption: "Confirm + mark done after the call",
      href: "/leads?stage=meeting_booked",
      icon: Calendar,
    },
    {
      count: activeBatches,
      label: "Active batches",
      caption: "Running now — leads + sites coming in",
      href: "/batches?status=running",
      icon: Activity,
      live: activeBatches > 0,
    },
  ].filter((r) => r.count > 0);

  const totalPending = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <section
      className="relative bg-surface rounded-lg shadow-hero overflow-hidden lg:row-span-2 flex flex-col"
      aria-label="Needs you"
    >
      {/* Indigo accent edge — marks this as the primary action surface */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-action" aria-hidden />

      <header className="px-6 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-action">Needs you</span>
          {rows.some((r) => r.live) && <span className="live-dot" aria-hidden />}
        </div>
        <span className="eyebrow">Today</span>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="px-6 pb-5">
            <span className="editorial-number text-ink text-[72px] leading-none">
              {totalPending}
            </span>
            <p className="mt-1 text-[12px] text-ink-muted">
              {totalPending === 1 ? "action waiting" : "actions waiting"}
            </p>
          </div>
          <div className="flex-1 flex flex-col divide-y divide-rule border-t border-rule">
            {rows.map((row) => <NeedsYouRow key={row.href} {...row} />)}
          </div>
        </>
      )}
    </section>
  );
}

function NeedsYouRow({ count, label, caption, href, icon: Icon, live }: Row) {
  return (
    <Link
      href={href}
      className="group px-6 py-4 flex items-center gap-4 hover:bg-surface-alt transition-colors"
    >
      <span className="mono-num text-[20px] font-semibold text-ink tabular-nums w-[36px] flex-shrink-0 text-right">
        {count}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
          <span className="text-[13px] font-semibold text-ink">{label}</span>
          {live && <span className="live-dot ml-1" aria-hidden />}
        </div>
        <p className="text-[11.5px] text-ink-muted mt-0.5 truncate">{caption}</p>
      </div>

      <ArrowUpRight
        className="h-4 w-4 text-ink-subtle group-hover:text-action group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all flex-shrink-0"
        strokeWidth={1.75}
      />
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 px-6 py-12 flex flex-col justify-center text-center">
      <p className="editorial-head text-ink text-xl">Nothing pending</p>
      <p className="text-ink-muted text-[12.5px] mt-2 max-w-[28ch] mx-auto leading-snug">
        Run a new batch to get started, or check Status for the longer view.
      </p>
    </div>
  );
}
