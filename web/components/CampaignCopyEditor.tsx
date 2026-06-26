"use client";

/**
 * CampaignCopyEditor.tsx — edit the outreach copy per step for ONE campaign.
 *
 * Inputs:  segment (drives how many steps), a sample lead (for the live preview),
 *          value (per-step overrides) + onChange
 * Outputs: calls onChange with { "1": { subject?, body? }, ... }; blank fields
 *          fall back to the system default at send time.
 * Used by: NewCampaignForm (Review step) + the campaign detail page.
 *
 * Body is plain text with {{business_name}} / {{first_name}} / {{demo_link}}
 * tokens and {spintax|variants}. The live preview (CampaignEmailPreview) shows
 * the result — default copy where a step is left blank, your copy where filled.
 */

import { useState } from "react";
import { variantFor, maxStepForVariant, type SeqCopyOverride } from "@/lib/email/sequence-templates";
import type { CallSegment } from "@/lib/segment";
import { CampaignEmailPreview } from "@/components/CampaignEmailPreview";

const DAY_BY_STEP: Record<number, number> = { 1: 0, 2: 4, 3: 8, 4: 12 };

export type CopyOverrides = Record<string, SeqCopyOverride>;

export function CampaignCopyEditor({
  segment,
  sample,
  value,
  onChange,
}: {
  segment: CallSegment;
  sample: { business_name: string; demo_url: string | null };
  value: CopyOverrides;
  onChange: (next: CopyOverrides) => void;
}) {
  const [editing, setEditing] = useState(false);
  const maxStep = maxStepForVariant(variantFor(segment));

  function set(step: number, field: "subject" | "body", v: string) {
    const next: CopyOverrides = { ...value, [step]: { ...value[String(step)], [field]: v } };
    // Drop an entry that's gone fully blank so it cleanly falls back to default.
    const e = next[String(step)];
    if (!e?.subject?.trim() && !e?.body?.trim()) delete next[String(step)];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow text-ink-muted">Email copy</p>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="text-[12px] font-semibold text-action underline underline-offset-2 hover:text-ink"
        >
          {editing ? "Done editing" : "Edit copy"}
        </button>
      </div>

      {editing && (
        <div className="rounded-lg border border-rule p-3 space-y-3 bg-surface-alt/40">
          <p className="text-[11px] text-ink-muted">
            Leave a step blank to use the system default. Tokens:{" "}
            <code className="text-[11px] bg-surface px-1 rounded">{"{{business_name}}"}</code>{" "}
            <code className="text-[11px] bg-surface px-1 rounded">{"{{first_name}}"}</code>{" "}
            <code className="text-[11px] bg-surface px-1 rounded">{"{{demo_link}}"}</code>. Word
            variation: <code className="text-[11px] bg-surface px-1 rounded">{"{quick|short} note"}</code>.
          </p>
          {Array.from({ length: maxStep }, (_, i) => i + 1).map((step) => (
            <div key={step} className="space-y-1.5">
              <p className="mono-num text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                Step {step} · Day {DAY_BY_STEP[step] ?? (step - 1) * 4}
              </p>
              <input
                type="text"
                value={value[String(step)]?.subject ?? ""}
                onChange={(e) => set(step, "subject", e.target.value)}
                placeholder="Subject — leave blank for the default"
                className="w-full h-8 px-2 text-[12.5px] border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none bg-white"
              />
              <textarea
                value={value[String(step)]?.body ?? ""}
                onChange={(e) => set(step, "body", e.target.value)}
                rows={4}
                placeholder={"Body — leave blank for the default.\nHi {{first_name}}, ..."}
                className="w-full px-2 py-1.5 text-[12.5px] border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none resize-y bg-white"
              />
            </div>
          ))}
        </div>
      )}

      <CampaignEmailPreview segment={segment} sample={sample} overrides={value} />
    </div>
  );
}
