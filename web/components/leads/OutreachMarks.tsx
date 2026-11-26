/**
 * leads/OutreachMarks.tsx — the small "already sent" lines under a lead's Reach out buttons (Leads list, 26 Nov 2026).
 *
 * Inputs:  mark (lib/leads/outreach-marks.ts): emails sent + last date, the newest contact form attempt
 * Outputs: "Emailed 25 Nov" / "Form: AI is filling it…" / "Form sent 25 Nov"; nothing when nothing was sent
 *          (`fallback` shows a dash instead: closed leads have no buttons above it)
 * Used by: components/LeadsTable.tsx
 */
"use client";

import { ClipboardList, MailCheck } from "lucide-react";
import { cx } from "@/lib/cx";
import { emailMarkLabel, formMarkLabel, shortDay, type MarkTone, type OutreachMark } from "@/lib/leads/outreach-marks";

const TONE: Record<MarkTone, string> = {
  positive: "text-positive",
  warning: "text-warning",
  urgent: "text-urgent",
  neutral: "text-ink-muted",
};

export function OutreachMarks({ mark, fallback }: { mark?: OutreachMark | null; fallback?: boolean }) {
  const email = mark ? emailMarkLabel(mark) : null;
  const form = mark?.form ? formMarkLabel(mark.form.status) : null;
  if (!email && !form) return fallback ? <span className="text-ink-subtle text-[12px]">&mdash;</span> : null;
  return (
    <div className="space-y-0.5 text-[11px] leading-tight">
      {email && (
        <div className="flex items-center gap-1 text-positive" title="We already sent this lead an email (see the lead's history for each one)">
          <MailCheck className="h-3 w-3 flex-none" strokeWidth={2} aria-hidden /> {email}
        </div>
      )}
      {form && mark?.form && (
        <div className={cx("flex items-center gap-1", TONE[form.tone], form.active && "animate-pulse")} title="Their website's contact form (open the lead's Contact page for the screenshots)">
          <ClipboardList className="h-3 w-3 flex-none" strokeWidth={2} aria-hidden /> {form.label}
          {!form.active && form.tone === "positive" ? ` ${shortDay(mark.form.at)}` : ""}
        </div>
      )}
    </div>
  );
}
