/**
 * leads/ContactFormStatus.tsx — where the lead's contact form send stands, on the lead page itself (26 Nov 2026).
 *
 * Inputs:  lead id; GET /api/leads/:id/contact-form (free; polled every 5 s while AI is working, 10 min at most);
 *          `watch` (any value that changes when a window closes, so the line is read again)
 * Outputs: one line: "Contact form: Filling in their form and sending it…  [Cancel]  [Details]" / "…Sent…" / the
 *          reason it wasn't sent; Cancel → POST { action: "cancel" } (honoured until AI presses Send); Details →
 *          onOpen (the Contact page window with the screenshots). Nothing when no attempt was made.
 * Used by: components/leads/ContactCard.tsx
 *
 * The operator asked to see the progress without keeping the window open, and to be able to stop it.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { cx } from "@/lib/cx";
import { formMarkLabel, shortDay, type MarkTone } from "@/lib/leads/outreach-marks";
import type { RunStatus } from "@/lib/contact-form/rules";

interface RunView {
  id: string;
  effective: RunStatus;
  text: string;
  sent_at: string | null;
  updated_at: string;
}

const POLL_MS = 5000;
const POLL_LIMIT_MS = 10 * 60_000;
const TONE: Record<MarkTone, string> = {
  positive: "border-positive/30 bg-positive-soft",
  warning: "border-warning/30 bg-warning-soft",
  urgent: "border-urgent/30 bg-urgent-soft",
  neutral: "border-rule bg-surface-alt",
};

export function ContactFormStatus({ leadId, watch, onOpen, onChange }: { leadId: string; watch?: unknown; onOpen: () => void; onChange?: () => void }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const started = useRef(Date.now());
  const lastStatus = useRef<RunStatus | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<{ run: RunView | null }>(`/api/leads/${leadId}/contact-form`);
    if (!r.success) return; // no table yet / offline: just no line
    const next = r.data.run;
    // A send that just finished: let the page refresh its history and stage.
    if (lastStatus.current && next && lastStatus.current !== next.effective && !formMarkLabel(next.effective)?.active) onChange?.();
    lastStatus.current = next?.effective ?? null;
    setRun(next);
  }, [leadId, onChange]);

  useEffect(() => {
    started.current = Date.now();
    void load();
  }, [load, watch]);

  const mark = run ? formMarkLabel(run.effective) : null;
  const active = !!mark?.active;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (Date.now() - started.current > POLL_LIMIT_MS) return clearInterval(t);
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    const r = await fetchJson<{ message: string }>(`/api/leads/${leadId}/contact-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setCancelling(false);
    if (r.success) toast.success(r.data.message);
    else toast.warning(r.error);
    await load();
  }

  // Nothing tried (or only a look at their form): no line.
  if (!run || !mark) return null;
  const when = !active ? shortDay(run.sent_at ?? run.updated_at) : "";
  return (
    <div className={cx("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[12px] text-ink", TONE[mark.tone])} role="status">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
        Contact form
      </span>
      <span className="min-w-0 flex-1">
        {run.text}
        {when ? ` (${when})` : ""}
        {active && <span className="block text-[11px] text-ink-subtle">About a minute or two. You can leave this page; it keeps going.</span>}
      </span>
      {active && (
        <button type="button" onClick={cancel} disabled={cancelling} className="font-semibold text-urgent hover:underline disabled:opacity-50" title="Stops it before AI presses Send. If Send was already pressed, the message is out.">
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
      <button type="button" onClick={onOpen} className="font-semibold text-action hover:underline">
        Details
      </button>
    </div>
  );
}
