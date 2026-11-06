"use client";

/**
 * CategoryEditor.tsx — the lead's niche / category, editable in place (imported leads arrive without one).
 *
 * Inputs:  leadId, category, buildable (does the current category have a DEDICATED template, vs the general one?)
 * Outputs: PATCH /api/leads/:id { category }, then router.refresh() so the Build button can appear
 * Used by: app/(dashboard)/leads/[id]/page.tsx (the "Category" info row)
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Tag } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { Button } from "@/components/ui/Button";

/** The niches the website builder has a template for, plus common spellings. */
const SUGGESTIONS = ["plumber", "electrician", "hvac contractor", "roofer", "landscaper", "dentist", "chiropractor", "restaurant", "auto repair shop", "flooring store", "gym", "salon"];

export function CategoryEditor({ leadId, category, buildable }: { leadId: string; category: string | null; buildable: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(category ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = value.trim() || null;
    if (next === (category ?? null)) return setEditing(false);
    setSaving(true);
    const r = await fetchJson<unknown>(`/api/leads/${leadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: next }) });
    setSaving(false);
    if (!r.success) return toast.error(r.error, { title: "Could not save the niche" });
    toast.success(next ? `Niche set to "${next}"` : "Niche cleared");
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="p-2 bg-surface-alt rounded"><Tag className="h-4 w-4 text-ink-muted" strokeWidth={1.75} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-[0.14em] font-mono">Category / niche</div>
        {editing ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <input
              id="lead-category"
              list="lead-category-suggestions"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
              placeholder="e.g. plumber, dentist, restaurant"
              autoFocus
              className="h-8 w-full rounded-lg border border-rule-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
            />
            <datalist id="lead-category-suggestions">{SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            <Button size="sm" loading={saving} onClick={save}>Save</Button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink hover:text-action" title="Change the niche">
            <span className="truncate">{category ?? "—"}</span>
            <Pencil className="h-3 w-3 text-ink-subtle group-hover:text-action" />
          </button>
        )}
        {!editing && !buildable && (
          <p className="text-[11px] text-ink-subtle mt-0.5">
            {category ? "No dedicated design for this niche — Build uses the general template." : "Set the niche so the right design is used (general template otherwise)."} Dedicated: trades, dentist, chiropractor, restaurant, auto repair.
          </p>
        )}
      </div>
    </div>
  );
}
