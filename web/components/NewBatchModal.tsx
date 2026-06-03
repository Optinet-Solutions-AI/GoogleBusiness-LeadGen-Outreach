"use client";

/**
 * NewBatchModal.tsx — the operator's most-used interaction.
 *
 * Inputs: niche, country, city, scraper toggle, limit slider. The site
 * template is derived from the niche on the server (templateForNiche),
 * so no template field is exposed here.
 * Side effect: live cost preview chip — calls /api/pricing/estimate on every
 * scraper/limit change. Submit → POST /api/batches.
 *
 * The "Suggest best market" button keeps the operator's niche and only
 * swaps country + city — see pickHighYieldMarket in @/lib/data/cities.
 *
 * The whole modal is keyboard-accessible: Esc closes; Enter submits.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Rocket, X, AlertTriangle, Sparkles } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import {
  NICHE_OPTIONS,
  NICHE_CATEGORIES,
  YIELD_DOT,
  YIELD_LABEL,
  type NicheYield,
} from "@/lib/data/niches";
import {
  CITY_OPTIONS,
  COUNTRIES,
  CONTINENTS,
  QUALITY_DOT,
  QUALITY_LABEL,
  countryLabel,
  pickHighYieldMarket,
  type CountryCode,
} from "@/lib/data/cities";

type Scraper = "apify" | "google_places" | "outscraper";

interface CostLine {
  item: string;
  qty: number;
  unit_usd: number;
  cost_usd: number;
}

interface CostGroup {
  subtotal_usd: number;
  lines: CostLine[];
}

interface Estimate {
  scraper: Scraper;
  requested_limit: number;
  effective_limit: number;
  estimated_qualifying: number;
  scrape: CostGroup;
  build: CostGroup;
  total_usd: number;
  breakdown: CostLine[];
  warnings: string[];
  free_credit_consumed_usd: number;
}

export function NewBatchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  // Default to a known-good combo so first-time users land on something
  // that actually returns leads (the previous default was plumber/Austin,
  // which has ~95% website saturation).
  const [niche, setNiche] = useState("estate sale company");
  const [country, setCountry] = useState<CountryCode>("us");
  const [city, setCity] = useState("Mobile, AL");
  const [scraper, setScraper] = useState<Scraper>("apify");
  const [limit, setLimit] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [suggestSource, setSuggestSource] = useState<"combo" | "fallback" | null>(null);

  /** Cities filtered to the currently-selected country, sorted by quality then size. */
  const citiesForCountry = useMemo(
    () =>
      CITY_OPTIONS
        .filter((c) => c.country === country)
        .sort((a, b) => {
          const qOrder = { good: 0, ok: 1, saturated: 2 };
          if (qOrder[a.quality] !== qOrder[b.quality]) return qOrder[a.quality] - qOrder[b.quality];
          return b.population_k - a.population_k;
        }),
    [country],
  );

  /** When country changes, snap city to the first preset for that country (if current isn't valid). */
  useEffect(() => {
    if (!citiesForCountry.some((c) => c.value === city) && citiesForCountry.length > 0) {
      setCity(citiesForCountry[0].value);
    }
  }, [country, citiesForCountry, city]);

  /** Metadata for the niche the user has currently typed/selected. */
  const matchedNiche = NICHE_OPTIONS.find((n) => n.value.toLowerCase() === niche.trim().toLowerCase());

  /** Metadata for the city the user has currently typed/selected. */
  const matchedCity = CITY_OPTIONS.find((c) => c.value.toLowerCase() === city.trim().toLowerCase());

  const canSuggest = niche.trim().length > 0;

  /** Suggest a high-yield market for the chosen niche. Preserves the niche
   *  the operator picked — only country + city change. If we have a curated
   *  combo for the niche we use it; otherwise we fall back to a random
   *  'good'-tier non-GDPR country + 'good'-quality city. */
  function suggestMarket() {
    const result = pickHighYieldMarket(niche);
    if (!result) return;
    setCountry(result.country);
    setCity(result.city);
    setSuggestSource(result.source);
  }

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  // Combobox option arrays — built once for niche (static), per-country for city.
  const nicheComboOptions = useMemo<ComboboxOption<{ yield: NicheYield; hint: string }>[]>(
    () =>
      NICHE_OPTIONS.map((n) => ({
        value: n.value,
        group: n.category,
        meta: { yield: n.yield, hint: n.hint },
      })),
    [],
  );

  const cityComboOptions = useMemo<
    ComboboxOption<{ quality: "good" | "ok" | "saturated"; population_k: number; region: string }>[]
  >(
    () =>
      citiesForCountry.map((c) => ({
        value: c.value,
        meta: { quality: c.quality, population_k: c.population_k, region: c.region },
      })),
    [citiesForCountry],
  );

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
      scraper === "apify"
        ? "Default. ~$2/1,000 — includes emails + Facebook/Instagram. Best all-round."
        : scraper === "google_places"
          ? "Official Google API. Free $200/mo credit, but no emails and can't store/market the data."
          : "$3 per 1,000 leads. Best at very large scale.",
    [scraper],
  );

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);

    // 1. Create the batch row (status='queued'). Fast: ~200ms.
    //    `template_slug` is intentionally NOT sent — the API derives it
    //    from the niche via templateForNiche(). Stops the operator from
    //    accidentally building a site with the wrong template.
    const created = await fetchJson<{ id: string }>("/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        niche,
        city,
        country_code: country,
        scraper,
        limit,
      }),
    });
    if (!created.success) {
      setSubmitError(created.error);
      setSubmitting(false);
      return;
    }

    // 2. Trigger the scrape and AWAIT the response. With Cloud Run Jobs the
    //    endpoint takes ~1s to mint a GCP access token and call the Run API,
    //    then returns 202 — the actual scrape continues in the background.
    //    Awaiting here is what guarantees the batch row flips queued → running
    //    before we navigate, so the user lands on a "running" page instead
    //    of a confusing "queued — click Re-run" page.
    const triggered = await fetchJson<{ status: string; runner: string }>(
      `/api/batches/${created.data.id}/run`,
      { method: "POST" },
    );
    if (!triggered.success) {
      // Trigger failed (Cloud Run misconfig, OIDC missing, etc.). The batch
      // row was created but is still 'queued'. Surface the error so the
      // operator knows; they can fix the underlying issue and click Re-run.
      setSubmitError(triggered.error);
      setSubmitting(false);
      return;
    }

    // 3. Close + navigate. Detail page polls for completion.
    onClose();
    router.refresh();
    router.push(`/batches/${created.data.id}`);
  }

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[480px] rounded-xl border border-rule shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center flex-none">
          <h2 className="text-headline-sm text-action">New batch</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={suggestMarket}
              disabled={!canSuggest}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-positive-soft border border-positive/30 text-positive text-[12px] font-semibold hover:bg-positive-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
              {canSuggest
                ? `Suggest best market for "${niche.trim()}"`
                : "Pick a niche first"}
            </button>
            {suggestSource === "combo" && (
              <p className="text-[10px] text-ink-muted">Curated combo on file for this niche.</p>
            )}
            {suggestSource === "fallback" && (
              <p className="text-[10px] text-ink-muted">
                No curated combo on file — using a high-tier {countryLabel(country)} market.
              </p>
            )}
          </div>

          <Field
            label="Niche"
            hint={
              matchedNiche ? (
                <YieldHint yield={matchedNiche.yield} text={matchedNiche.hint} />
              ) : (
                <span className="text-[10px] text-ink-subtle">
                  Type to search ({NICHE_OPTIONS.length} curated) or enter your own
                </span>
              )
            }
          >
            <Combobox
              value={niche}
              onChange={(v) => {
                setNiche(v);
                setSuggestSource(null);
              }}
              options={nicheComboOptions}
              inputRef={inputRef}
              placeholder="e.g. lawyer, personal trainer, food truck"
              renderOption={(o) => {
                const m = o.meta as { yield: NicheYield; hint: string } | undefined;
                return (
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    {m && (
                      <span
                        className={`shrink-0 h-1.5 w-1.5 rounded-full ${YIELD_DOT[m.yield]}`}
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink font-medium truncate">{o.value}</div>
                      {m && (
                        <div className="text-[10px] text-ink-muted truncate">
                          <span className="font-semibold uppercase tracking-wider">
                            {YIELD_LABEL[m.yield]}
                          </span>
                          <span className="mx-1">·</span>
                          {m.hint}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          </Field>

          <Field label="Country">
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value as CountryCode);
                setSuggestSource(null);
              }}
              className={INPUT_CLS}
            >
              {CONTINENTS.map((cont) => {
                const list = COUNTRIES.filter((c) => c.continent === cont);
                if (list.length === 0) return null;
                return (
                  <optgroup key={cont} label={cont}>
                    {list.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>

          <Field
            label={`City (${citiesForCountry.length} curated)`}
            hint={
              matchedCity ? (
                <CityHint quality={matchedCity.quality} populationK={matchedCity.population_k} region={matchedCity.region} />
              ) : (
                <span className="text-[10px] text-ink-subtle">
                  Type to search curated cities or enter your own
                </span>
              )
            }
          >
            <Combobox
              value={city}
              onChange={(v) => {
                setCity(v);
                setSuggestSource(null);
              }}
              options={cityComboOptions}
              placeholder="e.g. Mobile, AL"
              renderOption={(o) => {
                const m = o.meta as
                  | { quality: "good" | "ok" | "saturated"; population_k: number; region: string }
                  | undefined;
                return (
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    {m && (
                      <span
                        className={`shrink-0 h-1.5 w-1.5 rounded-full ${QUALITY_DOT[m.quality]}`}
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink font-medium truncate">{o.value}</div>
                      {m && (
                        <div className="text-[10px] text-ink-muted truncate">
                          <span className="font-semibold uppercase tracking-wider">
                            {QUALITY_LABEL[m.quality]}
                          </span>
                          <span className="mx-1">·</span>
                          {m.population_k}k people · {m.region}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          </Field>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-label-caps text-ink-muted uppercase tracking-wider">Limit (cap)</label>
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
                  className="w-20 h-8 px-2 text-right font-mono text-[13px] text-action font-bold border border-rule-strong rounded-md focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
                />
                <span className="text-[12px] text-ink-muted">max</span>
              </div>
            </div>
            <input
              type="range"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full h-1.5 bg-rule-strong rounded-lg appearance-none cursor-pointer accent-action"
            />
            <div className="flex justify-between text-[10px] text-ink-subtle font-mono">
              <span>1</span>
              <span>500</span>
            </div>
            <p className="text-[10px] text-ink-muted leading-tight">
              Upper bound — small markets often have fewer total operators (e.g. only 5 estate sale companies in Mobile, AL). You&apos;ll see what was actually returned on the batch page.
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-label-caps text-ink-muted uppercase tracking-wider">Scraper provider</label>
            <div className="flex gap-3 flex-wrap">
              <ScraperButton selected={scraper === "apify"} onClick={() => setScraper("apify")}>
                Apify
              </ScraperButton>
              <ScraperButton selected={scraper === "google_places"} onClick={() => setScraper("google_places")}>
                Google Cloud Places
              </ScraperButton>
              <ScraperButton selected={scraper === "outscraper"} onClick={() => setScraper("outscraper")}>
                Outscraper
              </ScraperButton>
            </div>
            <p className="text-[11px] text-ink-muted leading-tight">{scraperCaption}</p>
          </div>

          <CostChip estimate={estimate} loading={estimating} />

          {limit > 30 && (
            <div className="rounded-lg bg-urgent-soft border border-urgent/30 px-3 py-2 text-[11px] text-urgent leading-relaxed">
              <span className="font-bold">⚠ {limit} may time out on Vercel.</span> Each Places API
              page takes ~5–20s; Vercel kills functions at 60s. Stick to <span className="font-bold">≤30</span> from
              the dashboard, or run from the CLI for bigger batches:
              <code className="block mt-1 font-mono text-[10px] bg-urgent/15 px-2 py-1 rounded">
                npm run --prefix web run:batch -- --niche=&quot;{niche}&quot; --city=&quot;{city}&quot; --limit={limit}
              </code>
            </div>
          )}

          <div className="rounded-lg bg-action-soft border border-action/30 px-3 py-2 text-[11px] text-action leading-relaxed">
            <span className="font-bold">Scrape-only run.</span> Pulls leads into your dashboard
            for review. To turn a lead into a live website, click <span className="font-bold">Build website</span> on
            its detail page. No Gemini quota or Cloudflare projects are created until you do.
          </div>

          {submitError && <SubmitErrorBlock error={submitError} />}
        </div>

        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex justify-end items-center gap-3 flex-none">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-ink-muted font-medium hover:bg-rule-strong transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !niche || !city}
            className="px-6 py-2 rounded-full bg-action text-white font-semibold hover:opacity-90 transition-all text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Rocket className="h-4 w-4" strokeWidth={2.5} />
            {submitting ? "Starting scrape…" : "Scrape leads"}
          </button>
        </footer>
      </section>
    </div>
  );
}

const INPUT_CLS =
  "w-full h-9 px-3 text-body-base border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-label-caps text-ink-muted uppercase tracking-wider">{label}</label>
      {children}
      {hint && <div className="pt-0.5">{hint}</div>}
    </div>
  );
}

function YieldHint({ yield: y, text }: { yield: NicheYield; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${YIELD_DOT[y]}`} />
      <span className="font-semibold uppercase tracking-wider">{YIELD_LABEL[y]}</span>
      <span className="truncate">— {text}</span>
    </div>
  );
}

function CityHint({
  quality,
  populationK,
  region,
}: {
  quality: "good" | "ok" | "saturated";
  populationK: number;
  region: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${QUALITY_DOT[quality]}`} />
      <span className="font-semibold uppercase tracking-wider">{QUALITY_LABEL[quality]}</span>
      <span>— {populationK}k people · {region}</span>
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
          ? "bg-action text-white"
          : "bg-surface-alt text-ink-muted border border-rule hover:bg-surface-alt",
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
      <div className="rounded-lg bg-warning-soft border border-warning/40 px-4 py-3 text-[12px] text-warning leading-relaxed space-y-2">
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
        <p className="text-[11px] text-warning italic mt-2">Original error: {error}</p>
      </div>
    );
  }

  if (isRlsError) {
    return (
      <div className="rounded-lg bg-warning-soft border border-warning/40 px-4 py-3 text-[12px] text-warning leading-relaxed space-y-2">
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
        <p className="text-[11px] text-warning italic mt-2">Original error: {error}</p>
      </div>
    );
  }

  if (isPlacesBlocked) {
    return (
      <div className="rounded-lg bg-warning-soft border border-warning/40 px-4 py-3 text-[12px] text-warning leading-relaxed space-y-2">
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
        <p className="text-[11px] text-warning italic mt-2">Original error: {error.slice(0, 200)}…</p>
      </div>
    );
  }

  if (isPlacesInvalidKey) {
    return (
      <div className="rounded-lg bg-warning-soft border border-warning/40 px-4 py-3 text-[12px] text-warning leading-relaxed space-y-2">
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
        <p className="text-[11px] text-warning italic mt-2">Original error: {error.slice(0, 200)}…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-urgent-soft border border-urgent/30 px-3 py-2 text-[12px] text-urgent leading-relaxed">
      <p className="font-semibold mb-0.5">Couldn&apos;t scrape</p>
      <p className="text-[11px] font-mono break-all">{error}</p>
    </div>
  );
}

function CostChip({ estimate, loading }: { estimate: Estimate | null; loading: boolean }) {
  if (!estimate && !loading) return null;
  return (
    <div className="bg-surface-alt rounded-xl p-4 border border-rule">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-ink">Estimated cost</p>
          {estimate && (
            <div className="mt-2 space-y-3">
              <CostGroupBlock
                title="Scraping"
                subtitle="Stage 1 — one-time per batch"
                group={estimate.scrape}
              />
              <CostGroupBlock
                title="Building websites"
                subtitle={`Stage 3 — per qualifying lead (~${estimate.estimated_qualifying})`}
                group={estimate.build}
              />
              {estimate.effective_limit < estimate.requested_limit && (
                <p className="text-[11px] text-ink-muted">
                  {estimate.effective_limit} leads after cap (requested {estimate.requested_limit})
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-lg font-mono font-bold text-action leading-none">
            {loading ? "…" : estimate ? `$${estimate.total_usd.toFixed(2)}` : "—"}
          </span>
          <span className="text-[10px] text-ink-muted mt-1 uppercase tracking-wide">total</span>
        </div>
      </div>
      {estimate && estimate.warnings.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-warning bg-warning-soft px-2 py-1.5 rounded border border-warning/20">
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

function CostGroupBlock({
  title,
  subtitle,
  group,
}: {
  title: string;
  subtitle: string;
  group: CostGroup;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline">
        <div>
          <p className="text-[12px] font-semibold text-ink">{title}</p>
          <p className="text-[10px] text-ink-muted">{subtitle}</p>
        </div>
        <span className="text-[12px] font-mono font-semibold text-ink">
          ${group.subtotal_usd.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {group.lines.map((b) => (
          <p key={b.item} className="text-[11px] text-ink-muted">
            {b.item}: ${b.unit_usd.toFixed(4)} × {b.qty} = ${b.cost_usd.toFixed(2)}
          </p>
        ))}
      </div>
    </div>
  );
}
