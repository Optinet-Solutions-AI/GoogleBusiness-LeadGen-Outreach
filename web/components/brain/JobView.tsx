/**
 * brain/JobView.tsx — one Brain job, from the questions to the running numbers.
 *
 * Inputs:  job id; GET /api/brain/jobs/:id (polled while it searches / judges / runs)
 * Outputs: asking → the missing question, the batch list or the settings as choices (PATCH refine / start) ·
 *          searching / planning → a progress line · review → the plan table + Approve ticked / Cancel ·
 *          running / paused / done → progress, "needs a person", Pause / Resume / Cancel / Raise budget (POST control)
 * Used by: components/brain/BrainClient.tsx
 *
 * Dumb: every rule (what may be ticked, the budget check, the gates) is the server's; this renders and posts.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { serviceEmail, isServiceKey } from "@/lib/email/service-templates";
import type { Question } from "@/lib/brain/command";
import type { JobSettings, JobStatus } from "@/lib/brain/rules";
import { DEFAULT_SETTINGS } from "@/lib/brain/rules";
import { approvePayload, initialPicks, isLive, isWorking, planTotals, progressOf, spendText, statusText, type RowPick } from "@/lib/brain/view";
import { PlanTable, offerLabel, type TableRow } from "./PlanTable";

interface Job {
  id: string;
  command: string;
  intent: "find_and_work" | "work_batch";
  status: JobStatus;
  ask: { missing: string | null };
  settings: JobSettings;
  batch_id: string | null;
  spent_usd: number;
  notice: string | null;
}
interface JobData {
  job: Job;
  questions?: Question[];
  estimate?: { totalUsd: number };
  candidates?: { id: string; label: string }[];
  rows: TableRow[];
}

const INPUT = "h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none";
const BOX = "rounded-lg border border-rule bg-surface p-4 space-y-3";

function settingsFrom(questions: Question[]): JobSettings {
  const v = <T,>(key: Question["key"], dflt: T): T => (questions.find((q) => q.key === key)?.value as T) ?? dflt;
  return {
    budgetUsd: v("budget", DEFAULT_SETTINGS.budgetUsd),
    channels: v("channels", DEFAULT_SETTINGS.channels),
    perDay: v("perDay", DEFAULT_SETTINGS.perDay),
    followUps: v("followUps", DEFAULT_SETTINGS.followUps),
    includeEu: v("includeEu", false),
  };
}

/** The settings as choices and tick-boxes, the suggested answers preselected. */
function Questions({ questions, busy, onStart }: { questions: Question[]; busy: boolean; onStart: (s: JobSettings) => void }) {
  const [s, setS] = useState<JobSettings>(() => settingsFrom(questions));
  const [otherBudget, setOtherBudget] = useState(false);
  const q = (key: Question["key"]) => questions.find((x) => x.key === key);
  const budget = q("budget");
  const channels = q("channels");
  const perDay = q("perDay");
  const followUps = q("followUps");
  const eu = q("includeEu");
  const callOff = !(channels?.value as JobSettings["channels"] | undefined)?.call;
  return (
    <div className={BOX}>
      <p className="text-[13px] font-semibold text-ink">Before I start</p>
      {budget && (
        <fieldset className="space-y-1">
          <legend className="text-[12px] font-semibold text-ink">{budget.label}</legend>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink">
            {budget.options!.map((o) => (
              <label key={o.value} className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="brain-budget"
                  checked={o.value === "other" ? otherBudget : !otherBudget && String(s.budgetUsd) === o.value}
                  onChange={() => {
                    setOtherBudget(o.value === "other");
                    if (o.value !== "other") setS({ ...s, budgetUsd: Number(o.value) });
                  }}
                />
                {o.label}
              </label>
            ))}
            {(otherBudget || !budget.options!.some((o) => o.value === String(s.budgetUsd))) && (
              <input type="number" min={1} max={500} value={s.budgetUsd} onChange={(e) => setS({ ...s, budgetUsd: Number(e.target.value) })} className={`${INPUT} w-24`} aria-label="Budget in dollars" />
            )}
          </div>
          {budget.note && <p className="text-[11px] text-ink-muted">{budget.note}</p>}
        </fieldset>
      )}
      {channels && (
        <fieldset className="space-y-1">
          <legend className="text-[12px] font-semibold text-ink">{channels.label}</legend>
          <div className="flex flex-wrap gap-4 text-[13px] text-ink">
            {channels.options!.map((o) => {
              const key = o.value as keyof JobSettings["channels"];
              const off = key === "call" && callOff;
              return (
                <label key={o.value} className={off ? "inline-flex items-center gap-1.5 text-ink-subtle" : "inline-flex items-center gap-1.5"}>
                  <input type="checkbox" disabled={off} checked={!off && s.channels[key]} onChange={(e) => setS({ ...s, channels: { ...s.channels, [key]: e.target.checked } })} />
                  {o.label}
                </label>
              );
            })}
          </div>
          {channels.note && <p className="text-[11px] text-ink-muted">{channels.note}</p>}
        </fieldset>
      )}
      {perDay && (
        <fieldset className="space-y-1">
          <legend className="text-[12px] font-semibold text-ink">{perDay.label}</legend>
          <div className="flex flex-wrap gap-4 text-[13px] text-ink">
            {perDay.options!.map((o) => {
              const key = o.value as keyof JobSettings["perDay"];
              return (
                <label key={o.value} className="inline-flex items-center gap-1.5">
                  <input type="number" min={0} max={30} value={s.perDay[key]} onChange={(e) => setS({ ...s, perDay: { ...s.perDay, [key]: Number(e.target.value) } })} className={`${INPUT} w-20`} aria-label={`${o.label} a day`} />
                  {o.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {followUps && (
        <fieldset className="space-y-1">
          <legend className="text-[12px] font-semibold text-ink">{followUps.label}</legend>
          <div className="flex flex-wrap gap-4 text-[13px] text-ink">
            {followUps.options!.map((o) => (
              <label key={o.value} className="inline-flex items-center gap-1.5">
                <input type="radio" name="brain-followups" checked={String(s.followUps) === o.value} onChange={() => setS({ ...s, followUps: Number(o.value) as JobSettings["followUps"] })} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {eu && (
        <label className="flex items-start gap-1.5 text-[13px] text-ink">
          <input type="checkbox" className="mt-0.5" checked={s.includeEu} onChange={(e) => setS({ ...s, includeEu: e.target.checked })} />
          <span>
            {eu.label}
            {eu.note && <span className="block text-[11px] text-ink-muted">{eu.note}</span>}
          </span>
        </label>
      )}
      <Button onClick={() => onStart(s)} loading={busy} disabled={busy}>
        Start
      </Button>
    </div>
  );
}

export function JobView({ jobId, onChanged }: { jobId: string; onChanged: () => void }) {
  const [data, setData] = useState<JobData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Record<string, RowPick>>({});
  const [answer, setAnswer] = useState("");
  const [batchId, setBatchId] = useState("");
  const [newBudget, setNewBudget] = useState("");

  const load = useCallback(async () => {
    const r = await fetchJson<JobData>(`/api/brain/jobs/${jobId}`);
    if (!r.success) return void setError(r.error);
    setError(null);
    setData((prev) => {
      // The ticks start from what the Brain decided; they are kept while the operator edits the plan.
      if (r.data.job.status === "review" && (prev?.job.status !== "review" || prev.job.id !== r.data.job.id)) setPicks(initialPicks(r.data.rows));
      if (prev && prev.job.status !== r.data.job.status) onChanged();
      return r.data;
    });
  }, [jobId, onChanged]);

  useEffect(() => {
    setData(null);
    setAnswer("");
    setBatchId("");
    void load();
  }, [load]);

  const status = data?.job.status;
  useEffect(() => {
    if (!status || !(isWorking(status) || status === "running")) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 30 * 60_000) return clearInterval(t);
      void load();
    }, isWorking(status) ? 5000 : 20000);
    return () => clearInterval(t);
  }, [status, load]);

  async function post(path: string, method: "PATCH" | "POST", body: unknown, okText?: string) {
    setBusy(true);
    const r = await fetchJson<Partial<JobData> & Record<string, unknown>>(`/api/brain/jobs/${jobId}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.success) {
      toast.warning(r.error);
      return null;
    }
    if (okText) toast.success(okText);
    await load();
    onChanged();
    return r.data;
  }

  const totals = useMemo(() => (data ? planTotals(data.rows, picks) : null), [data, picks]);
  const progress = useMemo(() => (data ? progressOf(data.rows) : null), [data]);
  const offersUsed = useMemo(() => {
    if (!data) return [];
    const keys = new Set(data.rows.filter((r) => picks[r.lead_id]?.approved).map((r) => picks[r.lead_id]?.offer ?? r.offer).filter(Boolean) as string[]);
    return [...keys];
  }, [data, picks]);

  if (error) return <p className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-[13px] text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const { job } = data;
  const sample = data.rows.find((r) => picks[r.lead_id]?.approved)?.business_name ?? "the business";

  return (
    <section className="space-y-4" aria-label="Brain job">
      <header className="space-y-1">
        <p className="text-[13px] text-ink">
          <span className="font-semibold">You:</span> {job.command}
        </p>
        <p className="text-[12px] text-ink-muted">
          <span className="font-semibold text-ink">{statusText(job)}</span>
          {job.status !== "asking" && <> · {spendText(job)}</>}
        </p>
        {job.notice && <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">{job.notice}</p>}
      </header>

      {job.status === "asking" && job.ask.missing && (
        <div className={BOX}>
          <p className="text-[13px] font-semibold text-ink">{job.ask.missing}</p>
          <div className="flex gap-2">
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} className={`${INPUT} flex-1`} maxLength={200} aria-label="Your answer" />
            <Button onClick={() => void post("", "PATCH", { action: "refine", missing: answer })} loading={busy} disabled={busy || !answer.trim()}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {job.status === "asking" && !job.ask.missing && data.candidates && (
        <div className={BOX}>
          <p className="text-[13px] font-semibold text-ink">Which batch should I work?</p>
          {data.candidates.length ? (
            <div className="flex gap-2">
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={`${INPUT} flex-1`} aria-label="Batch">
                <option value="">Pick a finished batch…</option>
                {data.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button onClick={() => void post("", "PATCH", { action: "refine", batchId })} loading={busy} disabled={busy || !batchId}>
                Use this batch
              </Button>
            </div>
          ) : (
            <p className="text-[12px] text-ink-muted">There is no finished batch yet. Ask me to find new leads instead.</p>
          )}
        </div>
      )}

      {job.status === "asking" && data.questions && (
        <Questions questions={data.questions} busy={busy} onStart={(settings) => void post("", "PATCH", { action: "start", settings }, job.intent === "find_and_work" ? "Searching now. This takes a few minutes." : "Judging the leads now.")} />
      )}

      {isWorking(job.status) && (
        <p className="flex items-center gap-2 rounded-lg border border-rule bg-surface-alt px-3 py-3 text-[13px] text-ink">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {job.status === "searching" ? "Searching Google Maps and checking each business (website, contacts). Usually 5 to 20 minutes." : "Judging each lead: contact or skip, which offer, which channels. A minute or two."}
          <span className="text-ink-muted">You can leave this page.</span>
        </p>
      )}

      {job.status === "review" && totals && (
        <>
          <div className={BOX}>
            <p className="text-[13px] text-ink">
              <span className="font-semibold">My plan:</span> {totals.leads} to contact ({totals.emails} emails · {totals.forms} contact forms · {totals.calls} calls), {totals.skipped} left out.
              Nothing is sent until you approve. A call only goes out for a row whose phone box stays ticked.
            </p>
            <p className="text-[11px] text-ink-muted">
              Order per lead: day 0 the email and the contact form, day 2 the AI call, then any follow-up emails. Everything stops for a lead as soon as they reply.
            </p>
            {offersUsed.length > 0 && (
              <details className="text-[12px] text-ink">
                <summary className="cursor-pointer font-semibold text-action">View the emails</summary>
                <div className="mt-2 space-y-3">
                  {offersUsed.filter(isServiceKey).map((o) => {
                    const e = serviceEmail(o, { businessName: sample });
                    return (
                      <div key={o} className="rounded-md border border-rule p-2">
                        <p className="font-semibold">{offerLabel(o)}</p>
                        <p className="text-ink-muted">Subject: {e.subject}</p>
                        <p className="mt-1 whitespace-pre-line">{e.body}</p>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-ink-muted">Shown for {sample}; each lead gets its own details and the sender&rsquo;s name. If you kept a saved template as an offer&rsquo;s starting email, that one is sent instead.</p>
                </div>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void post("/approve", "POST", { rows: approvePayload(data.rows, picks) }, "Approved. It runs by itself now.")
                }
                loading={busy}
                disabled={busy || !totals.leads}
              >
                Approve ticked ({totals.leads})
              </Button>
              <Button variant="ghost" onClick={() => window.confirm("Cancel this job? Nothing was sent.") && void post("/control", "POST", { action: "cancel" }, "Job cancelled.")} disabled={busy}>
                Cancel job
              </Button>
            </div>
          </div>
          <PlanTable rows={data.rows} picks={picks} onPick={(id, p) => setPicks((cur) => ({ ...cur, [id]: p }))} readOnly={false} />
        </>
      )}

      {(isLive(job.status) || job.status === "done" || job.status === "cancelled") && progress && progress.leads > 0 && (
        <>
          <div className={BOX}>
            <p className="text-[13px] text-ink">
              <span className="font-semibold">{progress.leads} leads</span> · {progress.wins} replied (wins) · {progress.formsSent} contact forms sent · {progress.callsQueued} calls queued · {progress.stopped} stopped · {progress.open} still going
            </p>
            {progress.needsPerson > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">
                <p className="font-semibold">Needs a person ({progress.needsPerson}): their contact form is protected or couldn&rsquo;t be filled.</p>
                <p>Open the lead, press Contact page, copy the message, send it on their site, then press &ldquo;I sent it myself&rdquo;.</p>
                <ul className="mt-1 list-disc pl-5">
                  {data.rows.filter((r) => r.approved && r.form_state === "needs_person").map((r) => (
                    <li key={r.lead_id}>
                      <Link href={`/leads/${r.lead_id}`} target="_blank" className="text-action hover:underline">
                        {r.business_name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isLive(job.status) && (
              <div className="flex flex-wrap items-center gap-2">
                {job.status === "running" ? (
                  <Button variant="secondary" onClick={() => void post("/control", "POST", { action: "pause" }, "Paused. Emails, forms and new calls wait.")} disabled={busy}>
                    Pause
                  </Button>
                ) : (
                  <Button onClick={() => void post("/control", "POST", { action: "resume" }, "Running again.")} disabled={busy}>
                    Resume
                  </Button>
                )}
                <Button variant="ghost" onClick={() => window.confirm("Cancel this job? Nothing more is sent; what already went out stays in each lead's history.") && void post("/control", "POST", { action: "cancel" }, "Job cancelled.")} disabled={busy}>
                  Cancel job
                </Button>
                <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink">
                  <input type="number" min={1} max={500} placeholder={`$${job.settings.budgetUsd}`} value={newBudget} onChange={(e) => setNewBudget(e.target.value)} className={`${INPUT} w-24`} aria-label="New budget in dollars" />
                  <Button size="sm" variant="secondary" onClick={() => void post("/control", "POST", { action: "raise_budget", budgetUsd: Number(newBudget) }, "Budget raised.").then(() => setNewBudget(""))} disabled={busy || !(Number(newBudget) > 0)}>
                    Raise budget
                  </Button>
                </span>
              </div>
            )}
          </div>
          <PlanTable rows={data.rows} picks={picks} onPick={() => undefined} readOnly />
        </>
      )}
    </section>
  );
}
