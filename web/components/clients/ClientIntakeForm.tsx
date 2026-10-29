"use client";

/**
 * ClientIntakeForm.tsx — the operator intake form (spec §4.4): what the business sells, tone, CTA...
 *
 * Inputs:  clientId, initial IntakeForm (or null)
 * Outputs: PUT /api/clients/:id/intake, toast, router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Intake tab)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { cx } from "@/lib/cx";

// Mirrors the server-side IntakeForm zod shape (lib/clients/sources.ts, server-only).
type CtaKind = "call" | "book" | "message" | "visit" | "website";
export type IntakeValues = {
  sells: string;
  customers: string;
  tone: string[];
  tone_note: string;
  always_mention: string;
  never_claim: string;
  cta_kind: CtaKind;
  cta_target: string;
  other: string;
};

const TONES = ["warm", "direct", "playful", "premium", "expert", "friendly", "plain"];
const CTA_KINDS: CtaKind[] = ["call", "book", "message", "visit", "website"];

const EMPTY: IntakeValues = {
  sells: "",
  customers: "",
  tone: [],
  tone_note: "",
  always_mention: "",
  never_claim: "",
  cta_kind: "call",
  cta_target: "",
  other: "",
};

const INPUT = "w-full bg-surface border border-rule rounded px-3 py-2 text-[13px] text-ink";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-ink mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-subtle mt-1">{hint}</span>}
    </label>
  );
}

export function ClientIntakeForm({ clientId, initial }: { clientId: string; initial: IntakeValues | null }) {
  const router = useRouter();
  const [f, setF] = useState<IntakeValues>({ ...EMPTY, ...(initial ?? {}) });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof IntakeValues>(k: K, v: IntakeValues[K]) => setF((p) => ({ ...p, [k]: v }));

  function toggleTone(t: string) {
    set("tone", f.tone.includes(t) ? f.tone.filter((x) => x !== t) : [...f.tone, t]);
  }

  async function save() {
    setSaving(true);
    const res = await fetchJson(`/api/clients/${clientId}/intake`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(f),
    });
    setSaving(false);
    if (!res.success) return void toast.error(res.error);
    toast.success("Intake saved.");
    router.refresh();
  }

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 space-y-4 max-w-3xl">
      <p className="text-[12.5px] text-ink-muted">
        What the owner told us. The next Brand Brain build treats this as the most trusted source.
      </p>
      <Field label="What do they sell?">
        <textarea className={INPUT} rows={3} value={f.sells} onChange={(e) => set("sells", e.target.value)} />
      </Field>
      <Field label="Who are their customers?">
        <textarea className={INPUT} rows={3} value={f.customers} onChange={(e) => set("customers", e.target.value)} />
      </Field>
      <div>
        <span className="block text-[12px] font-medium text-ink mb-1">Tone</span>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={f.tone.includes(t)}
              onClick={() => toggleTone(t)}
              className={cx(
                "px-3 py-1 rounded-full text-[12px] border capitalize",
                f.tone.includes(t)
                  ? "bg-ink text-surface border-ink"
                  : "bg-surface text-ink-muted border-rule hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          className={INPUT}
          placeholder="Tone note (optional)"
          value={f.tone_note}
          onChange={(e) => set("tone_note", e.target.value)}
        />
      </div>
      <Field label="Always mention">
        <textarea className={INPUT} rows={2} value={f.always_mention} onChange={(e) => set("always_mention", e.target.value)} />
      </Field>
      <Field label="Never claim">
        <textarea className={INPUT} rows={2} value={f.never_claim} onChange={(e) => set("never_claim", e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
        <Field label="Call to action">
          <select className={INPUT} value={f.cta_kind} onChange={(e) => set("cta_kind", e.target.value as CtaKind)}>
            {CTA_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="CTA target" hint="Phone number, booking link, page...">
          <input className={INPUT} value={f.cta_target} onChange={(e) => set("cta_target", e.target.value)} />
        </Field>
      </div>
      <Field label="Anything else">
        <textarea className={INPUT} rows={3} value={f.other} onChange={(e) => set("other", e.target.value)} />
      </Field>
      <Button onClick={save} loading={saving}>
        Save intake
      </Button>
    </div>
  );
}
