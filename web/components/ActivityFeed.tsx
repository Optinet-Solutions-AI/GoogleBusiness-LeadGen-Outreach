/**
 * ActivityFeed.tsx — chronological stream of recent pipeline events.
 *
 * Inputs:  array of activity events { id, kind, lead_id, lead_name, ts, meta }
 * Outputs: vertical list of events with a stamp glyph + relative time mono.
 *          Each row links to the corresponding lead detail page.
 * Used by: app/(dashboard)/page.tsx (mission control, below the funnel)
 *
 * Event kinds we care about (mapped from outreach_events + lead stage changes):
 *   email_sent        — outreach kicked off
 *   email_opened      — open tracked by Instantly
 *   replied           — customer replied (highest signal)
 *   email_bounced     — undeliverable
 *   deployed          — new site live on a *.pages.dev URL
 *   handed_over       — custom domain attached
 *   closed_won        — paid customer
 *
 * The renderer is forgiving — unknown kinds get a neutral dot + the kind string.
 */

import Link from "next/link";
import {
  MessageSquareText,
  Mail,
  MailOpen,
  AlertTriangle,
  Globe,
  Building,
  CheckCircle2,
} from "lucide-react";

export interface ActivityEvent {
  id: string;
  kind: string;
  lead_id?: string | null;
  lead_name?: string | null;
  business_name?: string | null;
  ts: string;
  meta?: Record<string, unknown> | null;
}

interface Props {
  events: ActivityEvent[];
  title?: string;
}

const KIND_META: Record<string, {
  glyph: typeof MessageSquareText;
  verb: string;
  tone: "ember" | "positive" | "neutral" | "warning";
}> = {
  replied:        { glyph: MessageSquareText, verb: "replied",          tone: "ember"    },
  email_opened:   { glyph: MailOpen,          verb: "opened the email", tone: "neutral"  },
  email_sent:     { glyph: Mail,              verb: "outreach sent",    tone: "neutral"  },
  email_bounced:  { glyph: AlertTriangle,     verb: "bounced",          tone: "warning"  },
  deployed:       { glyph: Globe,             verb: "site went live",   tone: "positive" },
  handed_over:    { glyph: Building,          verb: "handed over",      tone: "positive" },
  closed_won:     { glyph: CheckCircle2,      verb: "closed won",       tone: "ember"    },
};

const TONE_CLASS: Record<string, string> = {
  ember:    "text-action bg-action-soft",
  positive: "text-positive bg-positive-soft",
  warning:  "text-warning bg-warning-soft",
  neutral:  "text-ink-muted bg-surface-alt",
};

export function ActivityFeed({ events, title = "Recent activity" }: Props) {
  return (
    <section className="bg-surface rounded-lg border border-rule overflow-hidden">
      <header className="flex items-baseline justify-between px-5 py-4 border-b border-rule/60">
        <span className="eyebrow">{title}</span>
        <span className="text-[11.5px] text-ink-muted">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </header>

      {events.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="editorial-head text-ink text-lg">No recent activity</p>
          <p className="text-ink-muted text-[12px] mt-2">
            Events show up here as leads progress, replies come in, and sites deploy.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-rule/60">
          {events.map((e) => {
            const meta = KIND_META[e.kind] ?? {
              glyph: MessageSquareText,
              verb: e.kind.replace(/_/g, " "),
              tone: "neutral" as const,
            };
            const Glyph = meta.glyph;
            const name = e.business_name ?? e.lead_name ?? "A lead";
            const href = e.lead_id ? `/leads/${e.lead_id}` : "#";
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-surface-alt/60 transition-colors"
                >
                  <span
                    className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_CLASS[meta.tone]}`}
                  >
                    <Glyph className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-ink leading-snug">
                      <span className="font-semibold">{name}</span>
                      <span className="text-ink-muted"> · {meta.verb}</span>
                    </p>
                  </div>
                  <time className="mono-num text-[11px] text-ink-subtle flex-shrink-0" dateTime={e.ts}>
                    {relativeTime(e.ts)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
