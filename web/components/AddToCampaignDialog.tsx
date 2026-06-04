// web/components/AddToCampaignDialog.tsx
"use client";

/**
 * AddToCampaignDialog.tsx — pick a channel + a new/existing campaign, then add
 * the selected leads. Reports added vs skipped (not reachable / suppressed / dup).
 * Used by: components/LeadsTable.tsx (the "Add to campaign" action).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { CHANNELS, type Channel } from "@/lib/campaigns/eligibility";

interface ExistingCampaign { id: string; name: string; channel: string | null }
interface AddResult { added: number; skipped: { not_reachable: number; suppressed: number; already_member: number } }

export function AddToCampaignDialog({
  leadIds,
  onClose,
  onDone,
}: {
  leadIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState<ExistingCampaign[]>([]);
  const [existingId, setExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing campaigns of the chosen channel for the "add to existing" picker.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ campaigns: ExistingCampaign[] }>("/api/campaigns").then((r) => {
      if (cancelled || !r.success) return;
      setExisting(r.data.campaigns.filter((c) => c.channel === channel));
      setExistingId("");
    });
    return () => { cancelled = true; };
  }, [channel]);

  async function submit() {
    setError(null);
    setBusy(true);
    let res;
    if (mode === "existing") {
      if (!existingId) { setError("Pick a campaign."); setBusy(false); return; }
      res = await fetchJson<AddResult>(`/api/campaigns/${existingId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_ids: leadIds }),
      });
    } else {
      if (!name.trim()) { setError("Name the campaign."); setBusy(false); return; }
      res = await fetchJson<{ added: number; skipped: AddResult["skipped"] }>("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), source: "app", channel, lead_ids: leadIds }),
      });
    }
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    const r = res.data as AddResult;
    const skip = r.skipped.not_reachable + r.skipped.suppressed + r.skipped.already_member;
    toast.success(`${r.added} added${skip ? `, ${skip} skipped` : ""}.`, { title: "Added to campaign" });
    router.refresh();
    onDone();
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <section className="bg-white w-full max-w-[460px] rounded-xl border border-rule shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center">
          <h2 className="text-[15px] font-semibold text-ink">Add {leadIds.length} lead{leadIds.length === 1 ? "" : "s"} to a campaign</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-subtle hover:text-ink transition-colors"><X className="h-5 w-5" /></button>
        </header>

        <div className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Channel</label>
            <div className="grid grid-cols-2 gap-1.5">
              {CHANNELS.map((c) => (
                <button key={c.value} type="button" onClick={() => setChannel(c.value)}
                  className={["px-3 py-2 rounded-lg text-[12px] font-semibold border text-left transition-colors",
                    channel === c.value ? "bg-ink text-canvas border-ink" : "bg-surface-alt border-rule text-ink-muted hover:text-ink"].join(" ")}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-muted">Only the selected leads reachable by {CHANNELS.find((c) => c.value === channel)?.label} are added; the rest are skipped.</p>
          </div>

          <div className="flex gap-1 p-1 bg-surface-alt rounded-lg border border-rule">
            <button type="button" onClick={() => setMode("new")} className={["flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors", mode === "new" ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"].join(" ")}>New campaign</button>
            <button type="button" onClick={() => setMode("existing")} className={["flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors", mode === "existing" ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"].join(" ")}>Existing</button>
          </div>

          {mode === "new" ? (
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" autoFocus
              className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none" />
          ) : (
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)}
              className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white">
              <option value="">{existing.length ? "Select a campaign…" : "No campaigns on this channel yet"}</option>
              {existing.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex items-center justify-between gap-3">
          <p className="text-[12px] text-urgent font-medium min-h-[16px] flex-1 truncate">{error ?? ""}</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="button" onClick={submit} loading={busy}>Add to campaign</Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
