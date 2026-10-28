/**
 * CallCampaignControls.tsx — the "AI calling" panel on a call campaign: Voizo readiness,
 * today's quota, and how the campaign's calls went.
 *
 * Inputs:  CallPanelData (loaded server-side by lib/calls/load-call-panel) + campaign status
 * Outputs: display only. Activate / Pause live in the header (CampaignStatusActions).
 * Used by: app/(dashboard)/campaigns/[id]/page.tsx (channel = 'call')
 */

import { Phone } from "lucide-react";
import type { CallPanelData } from "@/lib/calls/load-call-panel";

function readiness(d: CallPanelData): { tone: string; dot: string; label: string; detail: string } {
  if (!d.configured) {
    return {
      tone: "text-warning", dot: "bg-warning", label: "Not connected",
      detail: "Add VOIZO_API_KEY to the environment to enable calling.",
    };
  }
  if (!d.status) {
    return {
      tone: "text-urgent", dot: "bg-urgent", label: "Voizo unreachable",
      detail: `Status check failed (${d.statusError ?? "unknown"}). No calls go out until it answers.`,
    };
  }
  if (d.status.shadow !== true) {
    return {
      tone: "text-urgent", dot: "bg-urgent", label: "Blocked: not a test campaign",
      detail: "Voizo's campaign has is_test switched off. Calling is refused until it's back on. Tell Chris.",
    };
  }
  if (d.status.ready) {
    return { tone: "text-positive", dot: "bg-positive", label: "Ready", detail: "Voizo can take a call now." };
  }
  if (d.status.callWindowOpen === false) {
    return { tone: "text-ink-muted", dot: "bg-ink-subtle", label: "Outside Voizo's calling hours", detail: "Calls resume when its window opens." };
  }
  if ((d.status.remainingToday ?? 1) <= 0) {
    return { tone: "text-warning", dot: "bg-warning", label: "Daily limit reached", detail: "Calls resume after the daily reset." };
  }
  return { tone: "text-action", dot: "bg-action", label: "On a call", detail: "One call at a time; the next one starts when it ends." };
}

function windowsLabel(d: CallPanelData): string | null {
  const w = d.status?.callWindows;
  if (!w?.length) return null;
  const hours = Array.from(new Set(w.map((x) => `${x.start}–${x.end}`)));
  const days = w.map((x) => x.day.slice(0, 1).toUpperCase() + x.day.slice(1, 3)).join(", ");
  return `${days} · ${hours.join(" / ")}${d.status?.timezone ? ` (${d.status.timezone})` : ""}`;
}

export function CallCampaignControls({ data, status }: { data: CallPanelData; status: string }) {
  const r = readiness(data);
  const c = data.counts;
  const s = data.status;
  const hours = windowsLabel(data);

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-ink-subtle" strokeWidth={1.75} />
        <p className="eyebrow text-ink-muted">AI calling · Voizo</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink">
          <span className={`inline-flex items-center gap-1.5 font-semibold ${r.tone}`}>
            <span className={`h-2 w-2 rounded-full ${r.dot}`} /> {r.label}
          </span>{" "}
          <span className="text-ink-muted">{r.detail}</span>
        </p>
        {s && (
          <p className="mono-num text-[11px] text-ink-subtle">
            {s.usedToday ?? 0}/{s.dailyCap ?? 100} today
            {hours ? ` · ${hours}` : ""}
          </p>
        )}
      </div>

      {status !== "active" && (
        <p className="text-[12px] text-ink-muted">
          {status === "paused" ? "Paused: no new calls start until you activate it again." : (
            <>
              Press <span className="font-semibold text-ink">Activate</span> to start calling. Members are dialled one at a
              time, only while both Voizo&apos;s hours and this campaign&apos;s hours are open. Unanswered leads get up to{" "}
              {data.maxAttempts} tries, {data.retryHours} hours apart.
            </>
          )}
        </p>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Calls placed" value={c.placed} />
        <Stat label="Qualified" value={c.qualified} tone="text-positive" hint="in the Inbox to follow up" />
        <Stat label="Said no" value={c.declined} />
        <Stat label="No answer" value={c.unreached} hint="retried later" />
        <Stat label="Wrong number" value={c.badNumber} />
      </dl>
    </section>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-md border border-rule bg-surface-alt/50 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-subtle">{label}</dt>
      <dd className={`mono-num text-[18px] font-semibold ${tone ?? "text-ink"}`}>{value}</dd>
      {hint && <p className="text-[10px] text-ink-subtle">{hint}</p>}
    </div>
  );
}
