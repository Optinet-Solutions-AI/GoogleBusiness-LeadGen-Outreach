"use client";

/**
 * PlanMonthWizard.tsx — modal wizard: configure a month, review proposed concepts, confirm cost, watch generation.
 *
 * Inputs:  clientId, month (YYYY-MM), existing plan (or null), products snapshot, onClose
 * Outputs: POST/PATCH/GET /api/clients/:id/plans[/:pid][/concepts|/generate], GET /api/pricing/creatives; router.refresh()
 * Used by: MonthHeader ("Plan a month")
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { TEMPLATES } from "@/lib/creatives/templates/registry";
import { isPlanGenerating, isPlanStalled, planEstimateCount } from "@/lib/creatives/state";
import {
  CREATIVE_KINDS,
  CTA_KINDS,
  PLATFORMS,
  TEMPLATE_KEYS,
  type Concept,
  type Platform,
  type TemplateKey,
} from "@/lib/creatives/types";
import type { PlanRow } from "@/lib/creatives/plans";
import type { ProductSnapshot } from "@/lib/clients/types";

const MAX_PER_PLAN = 20;
/** A clicked run that has neither claimed the plan nor left a heartbeat after this long did not start. */
const NO_START_MS = 3 * 60_000;
const FIELD = "border border-rule rounded px-2 py-1 text-[12.5px] text-ink bg-surface outline-none focus:border-ink";

type Detail = {
  plan: PlanRow;
  progress: { total: number; ready: number; failed: number; pending: number; rendering: number };
  /** Concepts a Generate run would (re)generate now: no creative yet, failed, never started or stalled. */
  remaining_count: number;
  remaining_estimate_usd: number;
};

function initialStep(plan: PlanRow | null): 1 | 2 | 3 {
  if (!plan) return 1;
  if (plan.status === "generating" || plan.status === "done" || plan.status === "ready") return 3;
  return 2;
}

export function PlanMonthWizard({
  clientId,
  month,
  plan: existing,
  products,
  onClose,
}: {
  clientId: string;
  month: string;
  plan: PlanRow | null;
  products: ProductSnapshot[];
  onClose: () => void;
}) {
  const router = useRouter();
  const base = `/api/clients/${clientId}/plans`;
  const [step, setStep] = useState<1 | 2 | 3>(initialStep(existing));
  const [plan, setPlan] = useState<PlanRow | null>(existing);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>(existing?.concepts ?? []);
  const [platforms, setPlatforms] = useState<Platform[]>(existing?.platforms ?? [...PLATFORMS]);
  const [perWeek, setPerWeek] = useState(existing?.posts_per_week ?? 2);
  const [aiBackgrounds, setAiBackgrounds] = useState(existing?.ai_backgrounds ?? true);
  const productList = products.filter((p) => !!p.id);
  const [productIds, setProductIds] = useState<string[]>(
    existing?.product_ids?.length ? existing.product_ids : productList.filter((p) => p.featured).map((p) => p.id as string),
  );
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  /** When the operator clicked Generate (ms); null when no run was started from this wizard. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const started = startedAt !== null;
  const sawRun = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const count = planEstimateCount(month, perWeek, MAX_PER_PLAN);

  // Step 1: live estimate.
  useEffect(() => {
    if (step !== 1) return;
    let cancelled = false;
    void fetchJson<{ usd: number }>(`/api/pricing/creatives?count=${count}&backgrounds=${aiBackgrounds ? count : 0}`).then((r) => {
      if (!cancelled && r.success) setEstimate(r.data.usd);
    });
    return () => {
      cancelled = true;
    };
  }, [step, count, aiBackgrounds]);

  const refreshDetail = useCallback(
    async (pid: string): Promise<Detail | null> => {
      const r = await fetchJson<Detail>(`${base}/${pid}`);
      if (!alive.current) return null;
      if (!r.success) {
        toast.error(r.error);
        return null;
      }
      setDetail(r.data);
      setPlan(r.data.plan);
      return r.data;
    },
    [base],
  );

  // Step 2 polling: wait for concepts or an error.
  const planId = plan?.id;
  useEffect(() => {
    if (step !== 2 || !proposing || !planId) return;
    const t = setInterval(async () => {
      const d = await refreshDetail(planId);
      if (!d) return;
      if (d.plan.concepts.length > 0) {
        setConcepts(d.plan.concepts);
        setProposing(false);
      } else if (d.plan.last_error) {
        setProposing(false);
        toast.error(d.plan.last_error);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [step, proposing, planId, refreshDetail]);

  // Step 3: load the estimate on entry; poll while generating. A `generating` plan whose claim is stale (the run
  // died: crash, deploy, dev-server restart) is treated as idle so Generate can resume it (spec §12.6).
  const stalled = !!plan && isPlanStalled(plan);
  const generating = plan?.status === "generating" && !stalled;
  useEffect(() => {
    if (step === 3 && planId) void refreshDetail(planId);
  }, [step, planId, refreshDetail]);
  useEffect(() => {
    if (step !== 3 || !planId || !(generating || startedAt)) return;
    const t = setInterval(async () => {
      const d = await refreshDetail(planId);
      if (!d) return;
      if (isPlanGenerating(d.plan)) {
        sawRun.current = true;
        return;
      }
      if (!startedAt && !sawRun.current) return;
      // the run is over (we saw it, or it left a heartbeat after our click) - or it never started at all
      const beat = d.plan.heartbeat_at ? Date.parse(d.plan.heartbeat_at) : 0;
      const ran = sawRun.current || (startedAt !== null && beat >= startedAt - 60_000);
      if (!ran && startedAt !== null && Date.now() - startedAt < NO_START_MS) return;
      if (!ran) toast.error("The generation run did not start. Try Generate again.");
      sawRun.current = false;
      setStartedAt(null);
      router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [step, generating, startedAt, planId, refreshDetail, router]);

  async function propose() {
    setBusy(true);
    try {
      let current = plan;
      if (!current) {
        const c = await fetchJson<{ plan: PlanRow }>(base, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ month, platforms, posts_per_week: perWeek, product_ids: productIds, ai_backgrounds: aiBackgrounds }),
        });
        if (!c.success) return toast.error(c.error);
        current = c.data.plan;
        setPlan(current);
      }
      const r = await fetchJson<unknown>(`${base}/${current.id}/concepts`, { method: "POST" });
      if (!r.success) return toast.error(r.error);
      setStep(2);
      setProposing(true);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndContinue() {
    if (!plan || concepts.length === 0) return;
    setBusy(true);
    try {
      const r = await fetchJson<{ plan: PlanRow }>(`${base}/${plan.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ concepts }),
      });
      if (!r.success) return toast.error(r.error);
      setPlan(r.data.plan);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!plan || !detail) return;
    setBusy(true);
    try {
      const r = await fetchJson<unknown>(`${base}/${plan.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed_estimate_usd: detail.remaining_estimate_usd }),
      });
      if (!r.success) {
        toast.error(r.error);
        void refreshDetail(plan.id);
        return;
      }
      sawRun.current = false;
      setStartedAt(Date.now());
      void refreshDetail(plan.id);
    } finally {
      setBusy(false);
    }
  }

  function patchConcept(i: number, patch: Partial<Concept>) {
    setConcepts((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function addConcept() {
    setConcepts((cur) => [
      ...cur,
      {
        slot_date: `${month}-01`,
        platforms: plan?.platforms ?? platforms,
        template_key: "offer",
        kind: "image",
        title: "New post",
        angle: "New post",
        product_id: null,
        claim_refs: [],
        cta_kind: CTA_KINDS[0],
        hashtags_seed: [],
      },
    ]);
  }

  const progress = detail?.progress;
  const total = plan?.concepts.length || progress?.total || 0;
  const done = (progress?.ready ?? 0) + (progress?.failed ?? 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const idle = !!plan && !generating && !started;
  const hasCreatives = (progress?.total ?? 0) > 0;
  // finished: generation is over (also when the wizard is reopened on a ready plan, or the last run stalled)
  const finished =
    idle && (plan?.status === "ready" || stalled || (hasCreatives && progress?.pending === 0 && progress?.rendering === 0));
  const showProgress = generating || started || finished;
  const readyN = progress?.ready ?? 0;
  const failedN = progress?.failed ?? 0;
  const pendingN = Math.max(0, total - readyN - failedN);
  const remainingN = detail?.remaining_count ?? 0;
  // spec §12.5/§12.6: a budget-stopped, partly failed or stalled month can be resumed from here
  const canResume = finished && !!detail && remainingN > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Plan a month">
      <div className="bg-surface border border-rule rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink">Plan {month}</h3>
          <span className="text-[11.5px] text-ink-muted">Step {step} of 3</span>
        </div>

        {step === 1 && (
          <div className="space-y-3 text-[12.5px] text-ink">
            <fieldset className="flex gap-4">
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 capitalize">
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={(e) => setPlatforms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
                  />
                  {p}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2">
              Posts per week
              <input
                type="number"
                min={1}
                max={7}
                value={perWeek}
                onChange={(e) => setPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
                className={`${FIELD} w-16`}
                aria-label="Posts per week"
              />
            </label>
            {productList.length > 0 && (
              <div>
                <div className="text-ink-muted mb-1">Products to feature</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {productList.map((p) => (
                    <label key={p.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={productIds.includes(p.id as string)}
                        onChange={(e) =>
                          setProductIds((cur) => (e.target.checked ? [...cur, p.id as string] : cur.filter((x) => x !== p.id)))
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={aiBackgrounds} onChange={(e) => setAiBackgrounds(e.target.checked)} />
              AI backgrounds
            </label>
            <p className="text-ink-muted" data-testid="wizard-estimate">
              {count} posts · up to ≈ ${estimate === null ? "…" : estimate.toFixed(2)} {aiBackgrounds ? " if every post gets an AI background" : ""} — the final figure (step 3) counts only the designs that use one, so it is usually lower. Nothing is generated until you confirm in step 3;
              proposing concepts is one small AI call.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {proposing ? (
              <p className="text-[12.5px] text-ink-muted">Proposing concepts… this takes a few seconds.</p>
            ) : concepts.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">No concepts yet. Propose concepts to continue.</p>
            ) : (
              <>
                <ul className="space-y-2" data-testid="concept-list">
                  {concepts.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 border border-rule rounded p-2">
                      <input
                        className={`${FIELD} flex-1 min-w-[180px]`}
                        value={c.title}
                        onChange={(e) => patchConcept(i, { title: e.target.value })}
                        aria-label="Concept title"
                      />
                      <input
                        type="date"
                        className={FIELD}
                        value={c.slot_date}
                        onChange={(e) => e.target.value && patchConcept(i, { slot_date: e.target.value })}
                        aria-label="Date"
                      />
                      <select
                        className={FIELD}
                        value={c.template_key}
                        onChange={(e) => {
                          const k = e.target.value as TemplateKey;
                          patchConcept(i, { template_key: k, kind: TEMPLATES[k].supportsCarousel ? c.kind : "image" });
                        }}
                        aria-label="Template"
                      >
                        {TEMPLATE_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {TEMPLATES[k].label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={FIELD}
                        value={c.product_id ?? ""}
                        onChange={(e) => patchConcept(i, { product_id: e.target.value || null })}
                        aria-label="Product"
                      >
                        <option value="">No product</option>
                        {productList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className={FIELD}
                        value={TEMPLATES[c.template_key].supportsCarousel ? c.kind : "image"}
                        disabled={!TEMPLATES[c.template_key].supportsCarousel}
                        onChange={(e) => patchConcept(i, { kind: e.target.value as Concept["kind"] })}
                        aria-label="Kind"
                      >
                        {CREATIVE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k === "image" ? "Single image" : "Carousel"}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="text-ink-muted hover:text-ink p-1"
                        onClick={() => setConcepts((cur) => cur.filter((_, j) => j !== i))}
                        aria-label="Remove concept"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="ghost" size="sm" onClick={addConcept} disabled={concepts.length >= MAX_PER_PLAN}>
                  <Plus size={13} aria-hidden /> Add concept
                </Button>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-[12.5px] text-ink">
            {stalled && !started && (
              <p className="text-warning" role="status">
                Previous run stalled — resuming picks up where it stopped (paid steps already done are not repeated).
              </p>
            )}
            {plan?.last_error && (
              <p className="text-bad" role="alert">
                {plan.last_error}
              </p>
            )}
            {showProgress ? (
              <>
                <div className="h-2 rounded bg-surface-alt overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
                </div>
                {finished ? (
                  <p data-testid="wizard-progress">
                    {readyN} of {total} posts ready · {failedN} failed · {pendingN} pending
                  </p>
                ) : (
                  <p data-testid="wizard-progress">
                    {readyN} ready · {failedN} failed · {Math.max(0, total - done)} remaining of {total}
                  </p>
                )}
                {finished && !canResume && <p className="text-ink-muted">Generation finished. Review the posts in the grid.</p>}
                {canResume && (
                  <p className="text-ink-muted">
                    {remainingN} post{remainingN === 1 ? "" : "s"} still to generate. Generate again to finish the month.
                  </p>
                )}
              </>
            ) : (
              <p className="text-ink-muted">
                {concepts.length} concepts ready. Generating renders the images, writes captions and may call the image AI.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {step === 3 && showProgress ? (
            <>
              {finished && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={hasCreatives}
                  title={hasCreatives ? "Regenerating a month is not supported" : undefined}
                  onClick={() => setStep(1)}
                >
                  Propose again
                </Button>
              )}
              {canResume && (
                <Button type="button" size="sm" variant="secondary" loading={busy} onClick={generate} data-testid="wizard-resume">
                  Generate remaining {remainingN} (≈ ${detail.remaining_estimate_usd.toFixed(2)})
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  router.refresh();
                  onClose();
                }}
              >
                {finished ? "View posts" : "Close (keeps running)"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              {step === 1 && (
                <Button type="button" size="sm" loading={busy} disabled={!platforms.length} onClick={propose}>
                  Propose concepts
                </Button>
              )}
              {step === 2 && concepts.length === 0 && !proposing && (
                <Button type="button" size="sm" loading={busy} onClick={propose}>
                  Propose concepts
                </Button>
              )}
              {step === 2 && concepts.length > 0 && !proposing && (
                <Button type="button" size="sm" loading={busy} onClick={saveAndContinue}>
                  Continue with {concepts.length} concepts
                </Button>
              )}
              {step === 3 && (
                <Button type="button" size="sm" loading={busy} disabled={!detail} onClick={generate}>
                  Generate {concepts.length} posts (≈ ${detail ? detail.remaining_estimate_usd.toFixed(2) : "…"})
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
