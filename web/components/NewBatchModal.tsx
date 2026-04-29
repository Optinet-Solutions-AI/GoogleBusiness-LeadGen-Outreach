"use client";

/**
 * NewBatchModal.tsx — the operator's most-used interaction.
 *
 * Inputs: niche, city, template, scraper toggle, limit slider.
 * Side effect: live cost preview chip — calls /api/pricing/estimate on every
 * scraper/limit change. Submit → POST /api/batches.
 *
 * The whole modal is keyboard-accessible: Esc closes; Enter submits.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Rocket, X, AlertTriangle } from "lucide-react";

type Scraper = "google_places" | "outscraper";

interface Estimate {
  scraper: Scraper;
  requested_limit: number;
  effective_limit: number;
  estimated_qualifying: number;
  total_usd: number;
  breakdown: Array<{ item: string; qty: number; unit_usd: number; cost_usd: number }>;
  warnings: string[];
  free_credit_consumed_usd: number;
}

const TEMPLATES = [
  { value: "trades", label: "Trades (plumbers, electricians, contractors)" },
  { value: "food-beverage", label: "Food & beverage (restaurants, cafés)" },
  { value: "beauty-wellness", label: "Beauty & wellness (salons, spas)" },
  { value: "professional-services", label: "Professional services (lawyers, accountants)" },
];

export function NewBatchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [niche, setNiche] = useState("plumber");
  const [city, setCity] = useState("Austin, TX");
  const [template, setTemplate] = useState("trades");
  const [scraper, setScraper] = useState<Scraper>("google_places");
  const [limit, setLimit] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live pricing
  useEffect(() => {
    let cancelled = false;
    setEstimating(true);
    fetch(`/api/pricing/estimate?scraper=${scraper}&limit=${limit}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success && j?.data) setEstimate(j.data as Estimate);
        setEstimating(false);
      })
      .catch(() => setEstimating(false));
    return () => {
      cancelled = true;
    };
  }, [scraper, limit]);

  const scraperCaption = useMemo(
    () =>
      scraper === "google_places"
        ? "Default. Free tier covers ~5,700 leads/mo."
        : "$3 per 1,000 leads. Best at scale.",
    [scraper],
  );

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, city, template_slug: template, scraper, limit }),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "Failed to create batch");
      onClose();
      router.refresh();
      router.push(`/batches/${json.data.id}`);
    } catch (err) {
      setSubmitError(String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[480px] rounded-xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-headline-sm text-brand">New batch</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Niche">
              <input
                ref={inputRef}
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="plumber, salon, restaurant…"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="City">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Austin, TX"
                className={INPUT_CLS}
              />
            </Field>
          </div>

          <Field label="Template">
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className={INPUT_CLS}
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-label-caps text-slate-500 uppercase tracking-wider">Limit</label>
              <span className="font-mono text-[13px] text-brand font-bold">{limit} leads</span>
            </div>
            <input
              type="range"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand"
            />
          </div>

          <div className="space-y-3">
            <label className="text-label-caps text-slate-500 uppercase tracking-wider">Scraper provider</label>
            <div className="flex gap-3">
              <ScraperButton selected={scraper === "google_places"} onClick={() => setScraper("google_places")}>
                Google Cloud Places
              </ScraperButton>
              <ScraperButton selected={scraper === "outscraper"} onClick={() => setScraper("outscraper")}>
                Outscraper
              </ScraperButton>
            </div>
            <p className="text-[11px] text-slate-500 leading-tight">{scraperCaption}</p>
          </div>

          <CostChip estimate={estimate} loading={estimating} />

          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[11px] text-blue-800 leading-relaxed">
            <span className="font-bold">Scrape-only run.</span> This pulls leads into your dashboard
            for review. To turn a lead into a live website, click <span className="font-bold">Build website</span> on
            its detail page. No Gemini quota is used and no Cloudflare projects are created until you do.
          </div>
        </div>

        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3">
          {submitError ? (
            <p className="text-[12px] text-rose-600 font-medium">{submitError}</p>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-full text-slate-600 font-medium hover:bg-slate-200 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !niche || !city}
              className="px-6 py-2 rounded-full bg-brand text-white font-semibold hover:opacity-90 transition-all text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <Rocket className="h-4 w-4" strokeWidth={2.5} />
              {submitting ? "Scraping…" : "Scrape leads"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

const INPUT_CLS =
  "w-full h-9 px-3 text-body-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-label-caps text-slate-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function ScraperButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 flex items-center justify-center gap-2 h-10 rounded-full font-medium text-sm transition-all",
        selected
          ? "bg-brand text-white"
          : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100",
      ].join(" ")}
    >
      {selected && <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.5} />}
      <span>{children}</span>
    </button>
  );
}

function CostChip({ estimate, loading }: { estimate: Estimate | null; loading: boolean }) {
  if (!estimate && !loading) return null;
  return (
    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-body-sm font-semibold text-slate-900">Estimated cost</p>
          {estimate && (
            <div className="mt-1 space-y-0.5">
              {estimate.breakdown.map((b) => (
                <p key={b.item} className="text-[11px] text-slate-500">
                  {b.item}: ${b.unit_usd.toFixed(4)} × {b.qty} = ${b.cost_usd.toFixed(2)}
                </p>
              ))}
              {estimate.effective_limit < estimate.requested_limit && (
                <p className="text-[11px] text-slate-500 mt-1">
                  {estimate.effective_limit} leads after cap (requested {estimate.requested_limit})
                </p>
              )}
            </div>
          )}
        </div>
        <span className="text-lg font-mono font-bold text-brand">
          {loading ? "…" : estimate ? `$${estimate.total_usd.toFixed(2)}` : "—"}
        </span>
      </div>
      {estimate && estimate.warnings.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-amber-700 bg-amber-50 px-2 py-1.5 rounded border border-amber-100">
          <AlertTriangle className="h-4 w-4 flex-none mt-0.5" strokeWidth={2} />
          <ul className="text-[11px] italic font-medium space-y-1">
            {estimate.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
