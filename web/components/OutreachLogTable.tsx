"use client";

/**
 * OutreachLogTable.tsx — a lead's outreach_events: search, event-type filter,
 * sortable event + time columns, paging.
 *
 * Inputs:  outreach events for one lead (newest first).
 * Outputs: readable labels (sequence step, contact-form "not sent" state) and
 *          links to the contact page + screenshot for contact-form events.
 * Used by: app/(dashboard)/leads/[id]/page.tsx
 */

import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { relativeTime } from "@/lib/format";

export interface OutreachEvent {
  id: string;
  kind: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  contact_form_filled: "Contact form filled · not sent",
  contact_form_blocked: "Contact form blocked · not sent",
  call_placed: "AI call placed",
  call_qualified: "AI call · qualified",
  call_declined: "AI call · said no",
  call_unreached: "AI call · no answer",
  call_completed: "AI call · talked, no decision",
  call_bad_number: "AI call · bad number",
  call_dnc: "AI call · do-not-call",
};

/** Human label for an event kind (filter options). */
function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replaceAll("_", " ");
}

/** Human label for one event — annotates a sequence send with its step. */
export function outreachLabel(e: OutreachEvent): string {
  const step = e.meta?.step;
  if (e.kind === "email_sent" && typeof step === "number") return `${kindLabel(e.kind)} (step ${step} of 4)`;
  if (e.kind.startsWith("call_") && e.kind !== "call_placed") {
    const secs = typeof e.meta?.duration_seconds === "number" ? e.meta.duration_seconds : null;
    const detail = [
      typeof e.meta?.outcome === "string" ? e.meta.outcome.replaceAll("_", " ") : null,
      secs != null ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : null,
    ].filter(Boolean).join(" · ");
    return detail ? `${kindLabel(e.kind)} (${detail})` : kindLabel(e.kind);
  }
  if (e.kind === "contact_form_blocked") {
    const reason = typeof e.meta?.reason === "string" && e.meta.reason ? ` (${e.meta.reason})` : "";
    return `${kindLabel(e.kind)}${reason}`;
  }
  return kindLabel(e.kind);
}

/** Links for a contact-form dry-run event: the page it was filled on + a screenshot. */
function ContactFormLinks({ e }: { e: OutreachEvent }) {
  if (e.kind !== "contact_form_filled" && e.kind !== "contact_form_blocked") return null;
  const page = typeof e.meta?.contact_url === "string" ? e.meta.contact_url : null;
  const shot = typeof e.meta?.screenshot_url === "string" ? e.meta.screenshot_url : null;
  if (!page && !shot) return null;
  return (
    <span className="ml-2 inline-flex gap-3 text-[11px]">
      {page && (
        <a href={page} target="_blank" rel="noreferrer" className="text-action hover:underline">
          contact page
        </a>
      )}
      {shot && (
        <a href={shot} target="_blank" rel="noreferrer" className="text-action hover:underline">
          screenshot
        </a>
      )}
    </span>
  );
}

export function OutreachLogTable({ events }: { events: OutreachEvent[] }) {
  const columns: DataColumn<OutreachEvent>[] = [
    {
      key: "event",
      label: "Event",
      sortValue: outreachLabel,
      filter: { label: "Event", value: (e) => e.kind, labelFor: kindLabel },
      render: (e) => (
        <span className="text-[13px] text-ink">
          {outreachLabel(e)}
          <ContactFormLinks e={e} />
        </span>
      ),
    },
    {
      key: "time",
      label: "Time",
      sortValue: (e) => e.created_at,
      render: (e) => <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(e.created_at)}</span>,
    },
  ];

  return (
    <DataTable
      rows={events}
      columns={columns}
      getRowId={(e) => e.id}
      storageKey="lead-outreach-log.columnOrder.v1"
      minWidth="min-w-[360px]"
      noun="events"
      search={{ placeholder: "Search events…", text: (e) => `${outreachLabel(e)} ${e.kind}` }}
    />
  );
}
