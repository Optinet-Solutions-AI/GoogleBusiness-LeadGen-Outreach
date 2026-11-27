/**
 * ProgressSteps.tsx — a running job's step list with ticks and one live line ("checking websites… 12 of 42"), like
 * Explee's setup screen (27 Nov 2026).
 *
 * Inputs:  a Progress record (lib/progress.ts) saved by the worker
 * Outputs: the steps (done ✓, running spinner, waiting) and, under the running step, the live line with a bar
 * Used by: components/BatchProgressPoller.tsx (batch page), components/brain/JobView.tsx (Brain page)
 *
 * Dumb.
 */
import { Check, Loader2, Pause } from "lucide-react";
import type { Progress } from "@/lib/progress";

export function ProgressSteps({ progress }: { progress: Progress }) {
  const pct = progress.total ? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100)) : null;
  return (
    <ol className="space-y-1.5" aria-live="polite">
      {progress.steps.map((s) => (
        <li key={s.key}>
          <div className="flex items-center gap-2 text-[13px]">
            {s.state === "done" ? (
              <Check className="h-4 w-4 flex-none text-positive" strokeWidth={2.5} aria-label="done" />
            ) : s.state === "running" && progress.paused ? (
              <Pause className="h-4 w-4 flex-none text-warning" strokeWidth={2.5} aria-label="paused" />
            ) : s.state === "running" ? (
              <Loader2 className="h-4 w-4 flex-none animate-spin text-action" aria-label="running" />
            ) : (
              <span className="mx-[5px] h-1.5 w-1.5 flex-none rounded-full bg-rule-strong" aria-label="waiting" />
            )}
            <span className={s.state === "waiting" ? "text-ink-subtle" : s.state === "running" ? "font-semibold text-ink" : "text-ink-muted"}>{s.label}</span>
          </div>
          {s.state === "running" && progress.line && (
            <div className="ml-6 mt-1 space-y-1">
              <p className="font-mono text-[12px] text-ink-muted">
                › {progress.line}
                {!progress.paused && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-ink-subtle align-middle" aria-hidden />}
              </p>
              {pct !== null && (
                <div className="h-1 w-48 overflow-hidden rounded bg-rule" aria-hidden>
                  <div className="h-full bg-action transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
