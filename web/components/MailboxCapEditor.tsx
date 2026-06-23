"use client";

/**
 * MailboxCapEditor.tsx — per-mailbox custom daily send-limit control.
 *
 * Inputs:  { id, email, dailyCap, warmupEnabled, warmupTarget }
 * Outputs: PATCH /api/email-accounts/:id { daily_cap } → toast + refresh
 * Used by: app/(dashboard)/email-accounts/page.tsx
 *
 * Shows the current daily limit read-only with an "Edit" affordance; editing
 * reveals an input + Save / Cancel. Saving pins a fixed per-account daily cap
 * (the API turns off the in-app warmup ramp so the number is authoritative).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function MailboxCapEditor({
  id,
  email,
  dailyCap,
  warmupEnabled,
  warmupTarget,
}: {
  id: string;
  email: string;
  dailyCap: number | null;
  warmupEnabled: boolean;
  warmupTarget: number;
}) {
  const router = useRouter();
  const current = dailyCap ?? warmupTarget ?? 50;
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(current));
  const [busy, setBusy] = useState(false);

  const n = Number(cap);
  const valid = Number.isFinite(n) && n >= 1 && n <= 2000;

  function startEdit() {
    setCap(String(current));
    setEditing(true);
  }
  function cancel() {
    setCap(String(current));
    setEditing(false);
  }
  async function save() {
    if (!valid || busy) return;
    if (Math.round(n) === current) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const res = await fetchJson(`/api/email-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_cap: Math.round(n) }),
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error, { title: "Couldn't update limit" });
      return;
    }
    toast.success(`${email}: daily limit set to ${Math.round(n)}/day.`);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-ink-muted">
        <span className="uppercase tracking-wider text-[10px] font-semibold text-ink-subtle">Daily limit</span>
        <span className="font-mono text-[12px] font-semibold text-ink">{current}/day</span>
        {dailyCap == null && warmupEnabled && (
          <span className="text-[10px] text-ink-subtle italic">auto-warmup</span>
        )}
        <button
          type="button"
          onClick={startEdit}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-action hover:underline"
        >
          <Pencil className="h-3 w-3" strokeWidth={2} />
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-ink-muted">
      <span className="uppercase tracking-wider text-[10px] font-semibold text-ink-subtle">Daily limit</span>
      <input
        type="number"
        min={1}
        max={2000}
        autoFocus
        value={cap}
        onChange={(e) => setCap(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        className="w-16 h-6 px-1.5 text-right font-mono text-[12px] text-ink border border-rule-strong rounded focus:ring-1 focus:ring-action/30 focus:border-action outline-none"
      />
      <span>/day</span>
      <button
        type="button"
        onClick={save}
        disabled={!valid || busy}
        className="ml-1 px-2 py-0.5 rounded bg-action text-white text-[11px] font-semibold hover:bg-action/90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="px-2 py-0.5 rounded border border-rule text-[11px] font-semibold text-ink-muted hover:bg-surface-alt disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
