/**
 * brain/BrainClient.tsx — the Brain page: tell it a job in plain words, see the jobs, open one.
 *
 * Inputs:  the jobs loaded by the page (lib/brain/jobs.ts listJobs); POST /api/brain/jobs { command };
 *          GET /api/brain/jobs (after a change)
 * Outputs: the command box (a reply for anything it can't do; a new job otherwise), the list of jobs with their
 *          status, and the selected job (components/brain/JobView.tsx)
 * Used by: app/(dashboard)/brain/page.tsx
 *
 * Dumb: nothing is searched or sent from this component; a job only starts from its own questions.
 */
"use client";

import { useCallback, useState } from "react";
import { Brain, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { relativeTime } from "@/lib/format";
import type { JobStatus } from "@/lib/brain/rules";
import { statusText } from "@/lib/brain/view";
import { JobView } from "./JobView";

export interface JobListItem {
  id: string;
  command: string;
  status: JobStatus;
  notice: string | null;
  spent_usd: number;
  settings: { budgetUsd: number };
  created_at: string;
}

const EXAMPLES = ["Get me 100 plumbers in Texas and work them", "Work the leads from the Austin dentists batch"];

export function BrainClient({ initialJobs }: { initialJobs: JobListItem[] }) {
  const [jobs, setJobs] = useState<JobListItem[]>(initialJobs);
  const [selected, setSelected] = useState<string | null>(initialJobs.find((j) => !["done", "cancelled", "failed"].includes(j.status))?.id ?? null);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetchJson<{ jobs: JobListItem[] }>("/api/brain/jobs");
    if (r.success) setJobs(r.data.jobs);
  }, []);

  async function give() {
    const text = command.trim();
    if (!text || sending) return;
    setSending(true);
    setReply(null);
    setError(null);
    const r = await fetchJson<{ kind: "reply"; text: string } | { kind: "job"; job: JobListItem }>("/api/brain/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: text }),
    });
    setSending(false);
    if (!r.success) return void setError(r.error);
    if (r.data.kind === "reply") return void setReply(r.data.text);
    setCommand("");
    setSelected(r.data.job.id);
    await refresh();
  }

  return (
    <div className="space-y-5">
      <form
        className="rounded-lg border border-rule bg-surface p-4 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void give();
        }}
      >
        <label htmlFor="brain-command" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Brain className="h-4 w-4" strokeWidth={2} aria-hidden /> What should I do?
        </label>
        <div className="flex gap-2">
          <input
            id="brain-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={EXAMPLES[0]}
            maxLength={500}
            disabled={sending}
            className="h-10 flex-1 px-3 text-[14px] text-ink border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
          />
          <Button type="submit" loading={sending} disabled={sending || command.trim().length < 3}>
            <Send strokeWidth={2} /> Give the job
          </Button>
        </div>
        <p className="text-[11px] text-ink-muted">
          Try:{" "}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              {i > 0 && " · "}
              <button type="button" className="text-action hover:underline" onClick={() => setCommand(ex)}>
                {ex}
              </button>
            </span>
          ))}
          . I ask a few settings first, then show you my plan. Nothing is sent before you approve it.
        </p>
        {reply && <p className="rounded-lg border border-rule bg-surface-alt px-3 py-2 text-[13px] text-ink">{reply}</p>}
        {error && <p className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</p>}
      </form>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside aria-label="Jobs" className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted font-mono">Jobs</p>
          {!jobs.length && <p className="text-[12px] text-ink-muted">No jobs yet.</p>}
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelected(j.id)}
              className={cx("block w-full rounded-lg border px-3 py-2 text-left", selected === j.id ? "border-action bg-action/5" : "border-rule bg-surface hover:bg-surface-alt")}
            >
              <span className="block truncate text-[13px] font-semibold text-ink">{j.command}</span>
              <span className="block text-[11px] text-ink-muted">
                {statusText(j)} · {relativeTime(j.created_at)}
              </span>
            </button>
          ))}
        </aside>
        <div className="min-w-0">{selected ? <JobView key={selected} jobId={selected} onChanged={refresh} /> : <p className="text-[13px] text-ink-muted">Give me a job above, or pick one from the list.</p>}</div>
      </div>
    </div>
  );
}
