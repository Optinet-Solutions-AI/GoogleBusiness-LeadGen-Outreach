/**
 * brain/BrainClient.tsx — the Brain page: tell it a job in plain words, see the jobs, open one.
 *
 * Inputs:  the jobs loaded by the page (lib/brain/jobs.ts listJobs); POST /api/brain/jobs { command } as JSON, or
 *          multipart (command + files) when files are attached (components/brain/Composer.tsx, 27 Nov 2026);
 *          GET /api/brain/jobs (after a change)
 * Outputs: the message box (text, files, voice; a reply for anything it can't do; a new job otherwise), the list of jobs with their
 *          status, and the selected job (components/brain/JobView.tsx)
 * Used by: app/(dashboard)/brain/page.tsx
 *
 * Dumb: nothing is searched or sent from this component; a job only starts from its own questions.
 */
"use client";

import { useCallback, useState } from "react";
import { Brain } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { relativeTime } from "@/lib/format";
import type { JobStatus } from "@/lib/brain/rules";
import { statusText } from "@/lib/brain/view";
import { JobView } from "./JobView";
import { Composer } from "./Composer";

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

  /** Sends the message; true = it went through (the box clears), false = keep it to fix. */
  async function give(text: string, files: File[]): Promise<boolean> {
    if (sending) return false;
    setSending(true);
    setReply(null);
    setError(null);
    let init: RequestInit;
    if (files.length) {
      // Multipart: the browser sets the boundary itself, so no Content-Type here.
      const form = new FormData();
      form.append("command", text);
      for (const f of files) form.append("files", f, f.name);
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: text }) };
    }
    const r = await fetchJson<{ kind: "reply"; text: string } | { kind: "job"; job: JobListItem }>("/api/brain/jobs", init);
    setSending(false);
    if (!r.success) {
      setError(r.error);
      return false;
    }
    if (r.data.kind === "reply") {
      setReply(r.data.text);
      return true;
    }
    setSelected(r.data.job.id);
    await refresh();
    return true;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-rule bg-surface p-4 space-y-2">
        <label htmlFor="brain-command" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Brain className="h-4 w-4" strokeWidth={2} aria-hidden /> What should I do?
        </label>
        <Composer sending={sending} placeholder={EXAMPLES[0]} text={command} onText={setCommand} onSend={give} />
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
          . Press + to attach a list of businesses (CSV / Excel) or a brief (PDF, Word, text, image), or the mic to speak. I ask a few
          settings first, then show you my plan. Nothing is sent before you approve it.
        </p>
        {reply && <p className="rounded-lg border border-rule bg-surface-alt px-3 py-2 text-[13px] text-ink">{reply}</p>}
        {error && <p className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</p>}
      </section>

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
