"use client";

/**
 * NewClientButton.tsx — "New client" button + modal (name, optional website URL).
 *
 * Inputs:  operator-typed name / website URL
 * Outputs: POST /api/clients, then navigates to /clients/<id>
 * Used by: app/(dashboard)/clients/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

const INPUT =
  "w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

export function NewClientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name the client."); return; }
    setError(null);
    setBusy(true);
    const url = website.trim();
    const res = await fetchJson<{ client: { id: string; name: string } }>("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), ...(url ? { website_url: url } : {}) }),
    });
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    toast.success(`${res.data.client.name} created.`, { title: "Client created" });
    router.push(`/clients/${res.data.client.id}`);
  }

  return (
    <>
      <Button variant="primary" type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New client
      </Button>
      {open && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4" onClick={close}>
          <form onSubmit={submit} className="bg-white w-full max-w-[440px] rounded-xl border border-rule shadow-xl" onClick={(e) => e.stopPropagation()}>
            <header className="px-6 py-4 border-b border-rule flex justify-between items-center">
              <h2 className="text-[15px] font-semibold text-ink">New client</h2>
              <button type="button" onClick={close} aria-label="Close" className="text-ink-subtle hover:text-ink transition-colors"><X className="h-5 w-5" /></button>
            </header>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Business name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" autoFocus className={INPUT} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Website URL (optional)</label>
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" className={INPUT} />
              </div>
            </div>
            <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex items-center justify-between gap-3">
              <p className="text-[12px] text-urgent font-medium min-h-[16px] flex-1 truncate">{error ?? ""}</p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" type="button" onClick={close}>Cancel</Button>
                <Button variant="primary" type="submit" loading={busy}>Create client</Button>
              </div>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
