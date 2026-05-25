/**
 * StageTimeline.tsx — horizontal journey indicator for a lead.
 *
 * Inputs:  current stage of the lead
 * Outputs: 9-step horizontal timeline (scraped → ... → closed_won) with the
 *          current stage highlighted as a filled pill and prior stages as
 *          subtle ticks. Terminal "off-path" stages (dead, closed_lost) are
 *          handled with an alternate rendering so the timeline still reads.
 * Used by: app/(dashboard)/leads/[id]/page.tsx (below NextStepPill)
 */

const HAPPY_PATH = [
  { key: "scraped",        label: "Scraped"   },
  { key: "enriched",       label: "Enriched"  },
  { key: "generated",      label: "Built"     },
  { key: "deployed",       label: "Deployed"  },
  { key: "outreached",     label: "Sent"      },
  { key: "replied",        label: "Replied"   },
  { key: "meeting_booked", label: "Meeting"   },
  { key: "improved",       label: "Improved"  },
  { key: "handed_over",    label: "Live"      },
  { key: "closed_won",     label: "Won"       },
] as const;

const OFF_PATH_FALLBACK_KEY = "outreached";

interface Props {
  currentStage: string;
}

export function StageTimeline({ currentStage }: Props) {
  const offPath = ["dead", "closed_lost", "needs_email", "meeting_done"].includes(currentStage);

  // For off-path stages, render the timeline as it WAS before the divergence,
  // plus a terminal chip on the right.
  const anchorKey = offPath
    ? currentStage === "needs_email"
      ? "deployed"
      : currentStage === "meeting_done"
        ? "meeting_booked"
        : OFF_PATH_FALLBACK_KEY
    : currentStage;

  const anchorIdx = Math.max(
    0,
    HAPPY_PATH.findIndex((s) => s.key === anchorKey),
  );

  return (
    <section className="bg-surface rounded-lg border border-rule px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="eyebrow">Journey</span>
        {offPath && (
          <span className="mono-num text-[10px] uppercase tracking-wider text-warning">
            {currentStage.replace(/_/g, " ")}
          </span>
        )}
      </div>

      <ol className="flex items-center gap-1 overflow-x-auto pb-1">
        {HAPPY_PATH.map((stage, i) => {
          const isCurrent = !offPath && stage.key === currentStage;
          const isPast = i < anchorIdx;
          const isFuture = i > anchorIdx;
          return (
            <li key={stage.key} className="flex items-center gap-1 flex-shrink-0">
              <Pill stage={stage.label} state={
                isCurrent ? "current" :
                isPast    ? "past" :
                            "future"
              } />
              {i < HAPPY_PATH.length - 1 && (
                <span
                  className={[
                    "h-px w-3 lg:w-4",
                    isPast ? "bg-ink" : "bg-rule",
                  ].join(" ")}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Pill({ stage, state }: { stage: string; state: "current" | "past" | "future" }) {
  const cls =
    state === "current"
      ? "bg-ink text-canvas border-ink shadow-sm"
      : state === "past"
        ? "bg-surface-alt text-ink border-rule"
        : "bg-transparent text-ink-subtle border-rule";
  return (
    <span
      className={`mono-num text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${cls} font-semibold whitespace-nowrap`}
    >
      {stage}
    </span>
  );
}
