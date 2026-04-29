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
import { fetchJson } from "@/lib/fetch-json";

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
  const [limit, setLimit] = useState(20);
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
    fetchJson<Estimate>(`/api/pricing/estimate?scraper=${scraper}&limit=${limit}`).then((j) => {
      if (cancelled) return;
      if (j.success) setEstimate(j.data);
      setEstimating(false);
    });
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

    // 1. Create the batch row (status='queued'). Fast: ~200ms.
    const created = await fetchJson<{ id: string }>("/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche, city, template_slug: template, scraper, limit }),
    });
    if (!created.success) {
      setSubmitError(created.error);
      setSubmitting(false);
      return;
    }

    // 2. Trigger the scrape. The endpoint uses Vercel's waitUntil() so
    //    the scrape continues in the background — we DON'T await it.
    //    `keepalive: true` lets the request survive even if the user closes
    //    the modal/tab before the trigger response lands.
    fetch(`/api/batches/${created.data.id}/run`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      /* network failure is fine — server-side retry isn't critical;
         the user lands on the detail page which will poll status. */
    });

    // 3. Close + navigate immediately. Detail page polls for live status.
    onClose();
    router.refresh();
    router.push(`/batches/${created.data.id}`);
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
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={limit}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isNaN(n)) return;
                    setLimit(Math.min(500, Math.max(1, Math.round(n))));
                  }}
                  className="w-20 h-8 px-2 text-right font-mono text-[13px] text-brand font-bold border border-slate-300 rounded-md focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
                />
                <span className="text-[12px] text-slate-500">leads</span>
              </div>
            </div>
            <input
              type="range"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
              <span>1</span>
              <span>500</span>
            </div>
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

          {limit > 30 && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-700 leading-relaxed">
              <span className="font-bold">⚠ {limit} may time out on Vercel.</span> Each Places API
              page takes ~5–20s; Vercel kills functions at 60s. Stick to <span className="font-bold">≤30</span> from
              the dashboard, or run from the CLI for bigger batches:
              <code className="block mt-1 font-mono text-[10px] bg-rose-100 px-2 py-1 rounded">
                npm run --prefix web run:batch -- --niche=&quot;{niche}&quot; --city=&quot;{city}&quot; --limit={limit}
              </code>
            </div>
          )}

          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[11px] text-blue-800 leading-relaxed">
            <span className="font-bold">Scrape-only run.</span> Pulls leads into your dashboard
            for review. To turn a lead into a live website, click <span className="font-bold">Build website</span> on
            its detail page. No Gemini quota or Cloudflare projects are created until you do.
          </div>

          {submitError && <SubmitErrorBlock error={submitError} />}
        </div>

        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
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

/**
 * SubmitErrorBlock — turns a raw API error into actionable UI. Detects the
 * "table not found / schema cache" case (very common for first-run users
 * who haven't applied db/schema.sql yet) and shows the exact fix steps.
 */
function SubmitErrorBlock({ error }: { error: string }) {
  const isSchemaError =
    /could not find the table|schema cache|relation .* does not exist/i.test(error);
  const isRlsError =
    /row-level security|row level security|violates rls|insufficient_privilege/i.test(error);
  const isPlacesBlocked =
    /API_KEY_SERVICE_BLOCKED|PERMISSION_DENIED.*places\.googleapis|places\.error 403/i.test(error);
  const isPlacesInvalidKey =
    /API_KEY_INVALID|Requests from referer .* are blocked|places\.error 401/i.test(error);

  if (isSchemaError) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-[12px] text-amber-900 leading-relaxed space-y-2">
        <p className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Database is empty — apply the schema first
        </p>
        <p>
          Your Supabase project is connected, but the tables don&apos;t exist yet. One-time setup:
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            Open your{" "}
            <a
              className="font-semibold underline"
              href="https://supabase.com/dashboard/project/nspxsyfickcaetbfzxlh/sql/new"
              target="_blank"
              rel="noreferrer"
            >
              Supabase SQL editor
            </a>
            .
          </li>
          <li>
            Copy the schema from{" "}
            <a
              className="font-semibold underline font-mono"
              href="https://raw.githubusercontent.com/Optinet-Solutions-AI/GoogleBusiness-LeadGen-Outreach/main/db/schema.sql"
              target="_blank"
              rel="noreferrer"
            >
              db/schema.sql
            </a>{" "}
            (Ctrl+A → Ctrl+C).
          </li>
          <li>Paste it into the editor and click <span className="font-semibold">Run</span>.</li>
          <li>Come back here and click <span className="font-semibold">Scrape leads</span> again.</li>
        </ol>
        <p className="text-[11px] text-amber-800 italic mt-2">Original error: {error}</p>
      </div>
    );
  }

  if (isRlsError) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-[12px] text-amber-900 leading-relaxed space-y-2">
        <p className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Wrong Supabase key in Vercel
        </p>
        <p>
          You used the <span className="font-mono font-bold">anon</span> key. We need the{" "}
          <span className="font-mono font-bold">service_role</span> key (it bypasses RLS). Fix:
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            Open{" "}
            <a
              className="font-semibold underline"
              href="https://supabase.com/dashboard/project/nspxsyfickcaetbfzxlh/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              Supabase API settings
            </a>{" "}
            → find <span className="font-mono">service_role secret</span> → Reveal → copy.
          </li>
          <li>
            In{" "}
            <a
              className="font-semibold underline"
              href="https://vercel.com/optinet-solutions-ais-andbox/google-business-lead-gen-outreach/settings/environment-variables"
              target="_blank"
              rel="noreferrer"
            >
              Vercel env vars
            </a>{" "}
            → edit <span className="font-mono">SUPABASE_SERVICE_KEY</span> → paste → Save.
          </li>
          <li>
            Vercel <span className="font-semibold">Deployments</span> → top deploy → ⋯ →{" "}
            <span className="font-semibold">Redeploy</span>.
          </li>
          <li>Try Scrape leads again.</li>
        </ol>
        <p className="text-[11px] text-amber-800 italic mt-2">Original error: {error}</p>
      </div>
    );
  }

  if (isPlacesBlocked) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-[12px] text-amber-900 leading-relaxed space-y-2">
        <p className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Google Places API isn&apos;t enabled or is blocked
        </p>
        <p>
          Your API key works but Google rejected the call. Either Places API (New) isn&apos;t enabled
          on the GCP project, or the key has restrictions that block it.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <a
              className="font-semibold underline"
              href="https://console.cloud.google.com/apis/library/places.googleapis.com"
              target="_blank"
              rel="noreferrer"
            >
              Enable Places API (New)
            </a>{" "}
            on the same GCP project as your key.
          </li>
          <li>
            <a
              className="font-semibold underline"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              Open Credentials
            </a>{" "}
            → click your key → API restrictions → either set to{" "}
            <span className="font-mono">Don&apos;t restrict</span> or include{" "}
            <span className="font-mono">Places API (New)</span> in the allowed list.
          </li>
          <li>Retry — no Vercel redeploy needed; Google takes effect immediately.</li>
        </ol>
        <p className="text-[11px] text-amber-800 italic mt-2">Original error: {error.slice(0, 200)}…</p>
      </div>
    );
  }

  if (isPlacesInvalidKey) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-[12px] text-amber-900 leading-relaxed space-y-2">
        <p className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Google Places API key invalid
        </p>
        <p>
          The <span className="font-mono">GOOGLE_PLACES_API_KEY</span> in Vercel is rejected by Google.
          Recreate it at{" "}
          <a
            className="font-semibold underline"
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            GCP Credentials
          </a>
          , paste into{" "}
          <a
            className="font-semibold underline"
            href="https://vercel.com/optinet-solutions-ais-andbox/google-business-lead-gen-outreach/settings/environment-variables"
            target="_blank"
            rel="noreferrer"
          >
            Vercel env vars
          </a>
          , redeploy.
        </p>
        <p className="text-[11px] text-amber-800 italic mt-2">Original error: {error.slice(0, 200)}…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700 leading-relaxed">
      <p className="font-semibold mb-0.5">Couldn&apos;t scrape</p>
      <p className="text-[11px] font-mono break-all">{error}</p>
    </div>
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
