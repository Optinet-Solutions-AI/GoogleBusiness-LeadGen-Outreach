/**
 * progress.ts — live progress of a running batch or Brain job: the steps with their state and one live line
 * ("checking websites… 12 of 42"), like Explee's step list (27 Nov 2026). Pure (safe in client components).
 *
 * Inputs:  the step list, the current step, the live line, counts; for the Brain page the job's status, its batch's
 *          progress and its own
 * Outputs: progressAt (a Progress record) · brainProgress (what the Brain page shows) · ProgressWriter (saves at most
 *          one record every 2 s, never throws into the work it reports on)
 * Used by: lib/pipeline/orchestrator.ts + stage-1-scrape.ts (batches.progress), lib/brain/plan.ts
 *          (brain_jobs.progress), app/api/batches/[id], app/api/brain/jobs/[id], components/ProgressSteps.tsx
 *
 * Migration 079 stores it; without it nothing is saved and the pages show their older one-line status.
 */

export type StepState = "waiting" | "running" | "done";

export interface ProgressStep {
  key: string;
  label: string;
  state: StepState;
}

export interface Progress {
  steps: ProgressStep[];
  /** The step running now ("finished" = all done). */
  current: string;
  /** One live line, e.g. "checking websites and researching contacts… 12 of 42". */
  line: string;
  done?: number;
  total?: number;
  at: string;
  /** The job is waiting on a person (e.g. its search was paused): show it as paused, not spinning. */
  paused?: boolean;
}

type StepDef = { key: string; label: string };

export const BATCH_STEPS: StepDef[] = [
  { key: "search", label: "Find businesses" },
  { key: "check", label: "Check each business (website, contacts, score)" },
  { key: "save", label: "Save the leads" },
];

export const BRAIN_STEPS: StepDef[] = [
  { key: "understand", label: "Understand the job" },
  { key: "search", label: "Find businesses" },
  { key: "check", label: "Check each business (website, contacts, score)" },
  { key: "judge", label: "Judge each lead (offer, channels)" },
  { key: "plan", label: "Plan ready for you" },
];

export function progressAt(steps: StepDef[], current: string, line: string, now: Date, counts: { done?: number; total?: number } = {}): Progress {
  const idx = current === "finished" ? steps.length : steps.findIndex((s) => s.key === current);
  return {
    steps: steps.map((s, i) => ({ ...s, state: i < idx ? "done" : i === idx ? "running" : "waiting" })),
    current,
    line,
    ...(typeof counts.done === "number" ? { done: counts.done } : {}),
    ...(typeof counts.total === "number" ? { total: counts.total } : {}),
    at: now.toISOString(),
  };
}

/**
 * The Brain page's step list: while searching it follows the batch's progress; while planning its own. `missing` =
 * migration 079 isn't applied (null: the page keeps its older one-line status); `batchStatus` = the search batch's
 * status (a paused search shows as paused, not spinning).
 */
export function brainProgress(
  status: string,
  batch: Progress | null,
  own: Progress | null,
  now: Date,
  opts: { batchStatus?: string | null; missing?: boolean } = {},
): Progress | null {
  if (opts.missing) return null;
  if (status === "searching") {
    if (opts.batchStatus && opts.batchStatus !== "running" && opts.batchStatus !== "queued") {
      return { ...progressAt(BRAIN_STEPS, "search", "search paused: resume it on the batch page", now), paused: true };
    }
    if (!batch) return progressAt(BRAIN_STEPS, "search", "starting the search…", now);
    // The batch's "save" step is part of checking for the Brain; its "finished" means judging is next.
    const current = batch.current === "save" ? "check" : batch.current === "finished" ? "judge" : batch.current;
    return { ...progressAt(BRAIN_STEPS, current, batch.line, now, { done: batch.done, total: batch.total }), at: batch.at };
  }
  if (status === "planning") return own ?? progressAt(BRAIN_STEPS, "judge", "starting to judge the leads…", now);
  return null;
}

/**
 * Saves progress without slowing the work: the first record and every step change at once, otherwise at most one
 * record every `minMs`; `flush()` saves the last one held back (waiting at most `timeoutMs`). Saves go one at a time,
 * newest last, so an older record can never land after a newer one; a record waiting behind a slow save is replaced by
 * a newer one. A failed save is ignored (progress is a nicety) and nothing here ever throws into the work.
 */
export class ProgressWriter {
  private lastAt = -Infinity;
  private lastStep: string | null = null;
  /** Held back by the time limit. */
  private pending: Progress | null = null;
  /** Waiting for the save in flight. */
  private queued: Progress | null = null;
  private busy = false;
  private inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: (p: Progress) => Promise<void>,
    private readonly minMs = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  set(p: Progress): void {
    const t = this.now();
    if (p.current !== this.lastStep || t - this.lastAt >= this.minMs) {
      this.send(p, t);
    } else {
      this.pending = p;
    }
  }

  async flush(timeoutMs = 3000): Promise<void> {
    if (this.pending) this.send(this.pending, this.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.inflight, new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
    if (timer) clearTimeout(timer);
  }

  private send(p: Progress, t: number): void {
    this.lastAt = t;
    this.lastStep = p.current;
    this.pending = null;
    if (this.busy) this.queued = p;
    else this.inflight = this.run(p);
  }

  private run(p: Progress): Promise<void> {
    this.busy = true;
    let sent: Promise<void>;
    try {
      sent = Promise.resolve(this.write(p));
    } catch {
      sent = Promise.resolve();
    }
    return sent
      .catch(() => undefined)
      .then(() => {
        const next = this.queued;
        this.queued = null;
        if (next) return this.run(next);
        this.busy = false;
      });
  }
}
