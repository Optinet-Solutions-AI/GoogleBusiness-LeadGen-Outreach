"use client";

/**
 * BillingCard.tsx — record the agreed setup fee + monthly hosting on a lead.
 *
 * Inputs:  the lead's current billing fields
 * Outputs: POST /api/leads/[id]/billing → saves; record-only (no live charge).
 * Used by: the lead detail page (close-out area).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "Not billed" },
  { value: "invoiced", label: "Invoiced (setup sent)" },
  { value: "active", label: "Active (paying monthly)" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));

export function BillingCard({
  leadId,
  setupFee,
  monthlyAmount,
  billingStatus,
  billingNotes,
}: {
  leadId: string;
  setupFee: number | null;
  monthlyAmount: number | null;
  billingStatus: string | null;
  billingNotes: string | null;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState(setupFee != null ? String(setupFee) : "");
  const [monthly, setMonthly] = useState(monthlyAmount != null ? String(monthlyAmount) : "");
  const [status, setStatus] = useState(billingStatus ?? "");
  const [notes, setNotes] = useState(billingNotes ?? "");
  const [saving, setSaving] = useState(false);

  // Billing is OPTIONAL — many operators track payments elsewhere. Stay
  // collapsed unless this lead already has billing recorded or the operator
  // opens it.
  const hasData =
    setupFee != null || monthlyAmount != null || !!billingStatus || !!(billingNotes && billingNotes.trim());
  const [open, setOpen] = useState(hasData);

  async function save() {
    setSaving(true);
    const res = await fetchJson(`/api/leads/${leadId}/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setup_fee: setup.trim() === "" ? null : Number(setup),
        monthly_amount: monthly.trim() === "" ? null : Number(monthly),
        billing_status: status,
        billing_notes: notes.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.error, { title: "Save failed" });
    toast.success("Billing saved.");
    router.refresh();
  }

  // Collapsed: a slim opt-in row (with a one-line summary if billing exists).
  if (!open) {
    const summary = hasData
      ? [
          setupFee != null ? `$${setupFee} setup` : null,
          monthlyAmount != null ? `$${monthlyAmount}/mo` : null,
          billingStatus ? STATUS_LABEL[billingStatus] ?? billingStatus : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
    return (
      <section className="bg-surface border border-rule rounded-lg px-5 py-3.5 flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-ink-subtle" strokeWidth={1.75} />
        <div className="min-w-0">
          <span className="eyebrow">Billing</span>
          <span className="ml-2 text-[12px] text-ink-muted">{summary ?? "Optional — only if you track payments here"}</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto flex-none text-[12px] font-semibold text-action underline underline-offset-2 hover:text-ink"
        >
          {hasData ? "Edit" : "Record billing"}
        </button>
      </section>
    );
  }

  return (
    <section className="bg-surface border border-rule rounded-lg p-5 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-ink-subtle" strokeWidth={1.75} />
        <h2 className="eyebrow">Billing</h2>
        <span className="ml-auto text-[10px] text-ink-subtle">optional · record-only</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Setup fee</span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-subtle">$</span>
            <input
              type="number" min="0" step="1" inputMode="decimal"
              value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="0"
              className="h-9 w-full rounded-lg border border-rule-strong pl-6 pr-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
            />
          </div>
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Monthly hosting</span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-subtle">$</span>
            <input
              type="number" min="0" step="1" inputMode="decimal"
              value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0"
              className="h-9 w-full rounded-lg border border-rule-strong pl-6 pr-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-subtle">/mo</span>
          </div>
        </label>
      </div>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Status</span>
        <select
          value={status} onChange={(e) => setStatus(e.target.value)}
          className="h-9 w-full rounded-lg border border-rule-strong bg-white px-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Notes</span>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Invoice #, payment method, terms…"
          className="w-full resize-y rounded-lg border border-rule-strong px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
        />
      </label>

      <div className="flex items-center justify-end gap-3">
        <button onClick={() => setOpen(false)} className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink">
          Close
        </button>
        <Button variant="primary" size="sm" onClick={save} loading={saving}>Save billing</Button>
      </div>
    </section>
  );
}
