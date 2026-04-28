"use client";

/**
 * ImproveModal.tsx — operator-supplied data → re-runs stage 3 + stage 4.
 * POST /api/leads/[id]/improve
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Sparkles } from "lucide-react";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function ImproveModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [photosText, setPhotosText] = useState("");
  const [areasText, setAreasText] = useState("");
  const [hours, setHours] = useState<Record<string, string>>({});
  const [brandColor, setBrandColor] = useState("");
  const [notes, setNotes] = useState("");

  async function submit() {
    setError(null);
    setSubmitting(true);

    const photos = photosText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const service_areas = areasText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = { notes: notes || undefined };
    if (photos.length) payload.photos = photos;
    if (service_areas.length) payload.service_areas = service_areas;
    if (Object.values(hours).some(Boolean))
      payload.business_hours = Object.fromEntries(Object.entries(hours).filter(([, v]) => v));
    if (brandColor) payload.brand_color = brandColor;

    try {
      const res = await fetch(`/api/leads/${leadId}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "Failed");
      onClose();
      router.refresh();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <section className="bg-white w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-600" />
            <h2 className="text-headline-sm">Improve site</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-6 space-y-5">
          <Field label="Photos (one URL per line)">
            <textarea
              value={photosText}
              onChange={(e) => setPhotosText(e.target.value)}
              rows={3}
              placeholder="https://images.example.com/joe/truck.jpg&#10;https://images.example.com/joe/install.jpg"
              className="w-full p-3 text-body-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
            />
          </Field>

          <Field label="Service areas (comma- or newline-separated cities)">
            <textarea
              value={areasText}
              onChange={(e) => setAreasText(e.target.value)}
              rows={2}
              placeholder="South Austin, Bouldin, Zilker, Round Rock"
              className="w-full p-3 text-body-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
            />
          </Field>

          <Field label="Business hours">
            <div className="grid grid-cols-2 gap-2">
              {DAYS.map((d) => (
                <div key={d} className="flex items-center gap-2">
                  <span className="w-10 text-[12px] text-slate-500 uppercase font-semibold">{d}</span>
                  <input
                    value={hours[d] ?? ""}
                    onChange={(e) => setHours({ ...hours, [d]: e.target.value })}
                    placeholder="7am – 6pm"
                    className="flex-1 h-8 px-2 text-body-sm border border-slate-300 rounded-md focus:ring-1 focus:ring-brand/40 focus:border-brand outline-none"
                  />
                </div>
              ))}
            </div>
          </Field>

          <Field label="Brand color (override)">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandColor || "#1f4e79"}
                onChange={(e) => setBrandColor(e.target.value.toUpperCase())}
                className="h-10 w-14 rounded border border-slate-300 cursor-pointer"
              />
              <input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value.toUpperCase())}
                placeholder="#1F4E79"
                className="flex-1 h-9 px-3 text-body-base font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
              />
            </div>
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What changed and why."
              className="w-full p-3 text-body-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
            />
          </Field>
        </div>

        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3 sticky bottom-0">
          {error ? <p className="text-[12px] text-rose-600 font-medium">{error}</p> : <span className="text-[12px] text-slate-500">Rebuild + redeploy takes ~30 seconds.</span>}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2 rounded-full text-slate-600 font-medium hover:bg-slate-200 text-sm">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-6 py-2 rounded-full bg-brand text-white font-semibold text-sm disabled:opacity-50"
            >
              {submitting ? "Improving…" : "Improve"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-label-caps text-slate-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
