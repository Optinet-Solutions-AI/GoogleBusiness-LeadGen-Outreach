/**
 * brain/PlanTable.tsx — the Brain's plan, one row per lead: tick it, pick the offer, tick the channels, read why.
 *
 * Inputs:  rows (GET /api/brain/jobs/:id), the operator's ticks, onPick; `readOnly` once the job runs (the row's
 *          progress is shown instead of the tick-boxes)
 * Outputs: the table; changes go up through onPick (nothing is saved or sent from here)
 * Used by: components/brain/JobView.tsx
 *
 * Dumb: a row can only be given an offer / channel from its own allowed lists (the server checks again at Approve).
 */
"use client";

import Link from "next/link";
import { ClipboardList, Mail, PhoneCall } from "lucide-react";
import { cx } from "@/lib/cx";
import { SERVICES } from "@/lib/email/service-templates";
import type { Channel } from "@/lib/brain/rules";
import type { RowPick } from "@/lib/brain/view";

export interface TableRow {
  lead_id: string;
  business_name: string;
  verdict: string | null;
  /** The Website column's text: the AI check, else what the scrape found. */
  site?: string;
  decision: "contact" | "skip";
  offer: string | null;
  channels: Channel[];
  allowed_offers: string[];
  allowed_channels: Channel[];
  reason: string;
  source: "ai" | "rule" | "default";
  approved: boolean;
  form_state: string | null;
  call_state: string | null;
  outcome: string | null;
  outcome_reason: string | null;
}

const CHANNEL: Record<Channel, { label: string; Icon: typeof Mail }> = {
  email: { label: "Email", Icon: Mail },
  form: { label: "Contact form", Icon: ClipboardList },
  call: { label: "AI call (2 days later)", Icon: PhoneCall },
};
const ORDER: Channel[] = ["email", "form", "call"];
const VERDICT: Record<string, string> = { no_website: "No website", old_website: "Old website", good_website: "Good website" };
const FORM_STATE: Record<string, string> = { pending: "form waiting", sending: "form: AI is filling it…", sent: "form sent", needs_person: "form needs you", failed: "form not sent", skipped: "form skipped" };
const CALL_STATE: Record<string, string> = { pending: "call waiting", queued: "call queued", skipped: "call skipped" };
export const offerLabel = (key: string | null) => SERVICES.find((s) => s.key === key)?.label ?? key ?? "";

function progressText(r: TableRow): { text: string; tone: string } {
  if (r.outcome === "win") return { text: `Won: ${r.outcome_reason ?? "they answered"}`, tone: "text-positive font-semibold" };
  if (r.outcome === "stopped") return { text: `Stopped: ${r.outcome_reason ?? ""}`, tone: "text-ink-muted" };
  if (r.outcome === "done") return { text: "Done, no answer yet", tone: "text-ink-muted" };
  const parts = [r.channels.includes("email") ? "emails going" : null, r.form_state ? FORM_STATE[r.form_state] ?? r.form_state : null, r.call_state ? CALL_STATE[r.call_state] ?? r.call_state : null].filter(Boolean);
  return { text: parts.join(" · ") || "waiting", tone: r.form_state === "needs_person" ? "text-warning font-semibold" : "text-ink" };
}

export function PlanTable({ rows, picks, onPick, readOnly }: { rows: TableRow[]; picks: Record<string, RowPick>; onPick: (leadId: string, pick: RowPick) => void; readOnly: boolean }) {
  const shown = readOnly ? rows.filter((r) => r.approved) : rows;
  return (
    <div className="overflow-x-auto rounded-lg border border-rule">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-ink-muted">
          <tr>
            {!readOnly && <th className="px-2 py-2 w-8" />}
            <th className="px-2 py-2">Business</th>
            <th className="px-2 py-2">Website</th>
            <th className="px-2 py-2">Offer</th>
            <th className="px-2 py-2">{readOnly ? "Progress" : "Contact by"}</th>
            <th className="px-2 py-2">Why</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const p = picks[r.lead_id] ?? { approved: r.approved, channels: r.channels, offer: r.offer };
            const canTick = r.allowed_channels.length > 0 && r.allowed_offers.length > 0;
            const on = !readOnly && p.approved && canTick;
            const prog = readOnly ? progressText(r) : null;
            return (
              <tr key={r.lead_id} className={cx("border-t border-rule align-top", !readOnly && !on && "bg-surface-alt/50 text-ink-muted")}>
                {!readOnly && (
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Contact ${r.business_name}`}
                      checked={on}
                      disabled={!canTick}
                      title={canTick ? "Tick to contact this lead" : "This lead can't be reached, so it can't be ticked"}
                      onChange={(e) =>
                        onPick(r.lead_id, {
                          approved: e.target.checked,
                          // A skipped lead ticked back in starts with everything it allows.
                          channels: e.target.checked && !p.channels.length ? r.allowed_channels : p.channels,
                          offer: p.offer ?? r.allowed_offers[0] ?? null,
                        })
                      }
                    />
                  </td>
                )}
                <td className="px-2 py-2 font-semibold text-ink">
                  <Link href={`/leads/${r.lead_id}`} target="_blank" className="hover:underline">
                    {r.business_name}
                  </Link>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{r.site ?? (r.verdict ? VERDICT[r.verdict] ?? r.verdict : "—")}</td>
                <td className="px-2 py-2">
                  {readOnly || !on || r.allowed_offers.length < 2 ? (
                    <span>{offerLabel(p.offer ?? r.offer) || "—"}</span>
                  ) : (
                    <select
                      value={p.offer ?? ""}
                      aria-label={`Offer for ${r.business_name}`}
                      onChange={(e) => onPick(r.lead_id, { ...p, offer: e.target.value })}
                      className="h-8 max-w-[190px] rounded-md border border-rule-strong bg-white px-1.5 text-[12px] text-ink"
                    >
                      {r.allowed_offers.map((o) => (
                        <option key={o} value={o}>
                          {offerLabel(o)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-2">
                  {prog ? (
                    <span className={prog.tone}>{prog.text}</span>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      {ORDER.filter((c) => r.allowed_channels.includes(c)).map((c) => {
                        const { label, Icon } = CHANNEL[c];
                        return (
                          <label key={c} className="inline-flex items-center gap-1" title={label}>
                            <input
                              type="checkbox"
                              aria-label={`${label} for ${r.business_name}`}
                              disabled={!on}
                              checked={on && p.channels.includes(c)}
                              onChange={(e) => onPick(r.lead_id, { ...p, channels: ORDER.filter((x) => (x === c ? e.target.checked : p.channels.includes(x))) })}
                            />
                            <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          </label>
                        );
                      })}
                      {!r.allowed_channels.length && <span>—</span>}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 max-w-[320px]">
                  {r.reason}
                  {r.source === "default" && <span className="ml-1 rounded bg-surface-alt px-1 py-0.5 text-[10px] text-ink-subtle" title="The AI's answer wasn't usable (or it wasn't asked), so the standard rule was used">standard rule</span>}
                </td>
              </tr>
            );
          })}
          {!shown.length && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-ink-muted">
                No leads in this plan.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
