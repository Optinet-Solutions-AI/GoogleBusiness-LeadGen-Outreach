"use client";

/**
 * HandoverModal.tsx — attach customer's domain to the existing CF Pages
 * project (recommended) OR record a manual transfer.
 * POST /api/leads/[id]/handover
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Building, Globe, ArrowRightLeft } from "lucide-react";

type Mode = "attach" | "transfer";

interface DnsInstruction {
  type: "CNAME" | "A";
  name: string;
  value: string;
}

export function HandoverModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("attach");
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ dns: DnsInstruction[] } | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "attach" ? { mode, custom_domain: domain } : { mode }),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "Failed");
      if (mode === "attach") {
        setSuccess({ dns: json.data.dns_instructions ?? [] });
      } else {
        onClose();
      }
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <section className="bg-white w-full max-w-[520px] rounded-xl border border-slate-200 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5 text-emerald-600" />
            <h2 className="text-headline-sm">Hand over to customer</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        {success ? (
          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-emerald-800">
              Domain attached. Send the customer these DNS records:
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-[13px]">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 uppercase">
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {success.dns.map((r, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="py-2 pr-4 font-bold">{r.type}</td>
                      <td className="py-2 pr-4">{r.name}</td>
                      <td className="py-2 break-all text-brand">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-slate-500">
              SSL provisions automatically once the records propagate (usually 2–10 minutes).
            </p>
            <button onClick={onClose} className="w-full px-5 py-2 rounded-full bg-brand text-white text-sm font-semibold">
              Got it
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <div className="space-y-3">
              <label className="text-label-caps text-slate-500 uppercase tracking-wider">Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <ModeButton selected={mode === "attach"} onClick={() => setMode("attach")} icon={<Globe className="h-4 w-4" />} title="Attach" subtitle="Customer's domain on our hosting (recommended)" />
                <ModeButton selected={mode === "transfer"} onClick={() => setMode("transfer")} icon={<ArrowRightLeft className="h-4 w-4" />} title="Transfer" subtitle="Manual handoff in CF dashboard" />
              </div>
            </div>

            {mode === "attach" && (
              <div className="space-y-1.5">
                <label className="text-label-caps text-slate-500 uppercase tracking-wider">Customer domain</label>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="joesplumbing.com"
                  className="w-full h-9 px-3 text-body-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
                />
                <p className="text-[11px] text-slate-500">No protocol, no path. Just the domain.</p>
              </div>
            )}

            {mode === "transfer" && (
              <p className="text-[12px] text-slate-500">
                Records the intent. You still need to transfer the project to the customer&apos;s Cloudflare account by hand
                (Settings → Members & access in the CF dashboard).
              </p>
            )}
          </div>
        )}

        {!success && (
          <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3">
            {error ? <p className="text-[12px] text-rose-600 font-medium">{error}</p> : <span />}
            <div className="flex gap-3">
              <button onClick={onClose} className="px-5 py-2 rounded-full text-slate-600 font-medium hover:bg-slate-200 text-sm">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || (mode === "attach" && !domain)}
                className="px-6 py-2 rounded-full bg-brand text-white font-semibold text-sm disabled:opacity-50"
              >
                {submitting ? "Working…" : mode === "attach" ? "Attach domain" : "Mark transferred"}
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}

function ModeButton({
  selected, onClick, icon, title, subtitle,
}: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "text-left p-3 rounded-lg border transition-all",
        selected ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-1 font-semibold text-sm">{icon}{title}</div>
      <p className="text-[11px] text-slate-500 leading-tight">{subtitle}</p>
    </button>
  );
}
