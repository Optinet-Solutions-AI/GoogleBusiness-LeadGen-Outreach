/**
 * leads/LeadScoreBox.tsx — the lead page's "Lead score" box: the score, its band, why, what's holding it back, and
 * "Score again" (27 Nov 2026).
 *
 * Inputs:  leadId, score (leads.lead_score_detail from the page, null when not scored or before migration 076)
 * Outputs: POST /api/leads/:id/lead-score → router.refresh(); the refusal (2-minute wait, no key, no 076) as plain text
 * Used by: app/(dashboard)/leads/[id]/page.tsx
 *
 * Dumb: shows the saved score and fires the action. One OpenAI call, about half a cent. workflows/score_leads.md.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import { ScoreChip } from "@/components/leads/ScoreChip";
import { relativeTime } from "@/lib/format";
import type { LeadScore } from "@/lib/leads/lead-score";

export function LeadScoreBox({ leadId, score }: { leadId: string; score: LeadScore | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function rescore() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/lead-score`, { method: "POST" });
      const json = await res.json();
      if (!json.success) setMessage(json.error ?? "Couldn't score this lead.");
      else router.refresh();
    } catch {
      setMessage("Couldn't score this lead. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-surface border border-rule rounded-lg p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Lead score</p>
        {score && <ScoreChip score={score} />}
      </div>
      {score ? (
        <>
          <p className="text-[12px] text-ink-muted">How likely they are to reply and buy what we&apos;d offer them.</p>
          <ul className="text-[13px] text-ink list-disc pl-4 space-y-0.5">
            {score.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {score.holding_back && (
            <p className="text-[12px] text-ink-muted">
              <span className="font-semibold text-ink">Holding it back:</span> {score.holding_back}
            </p>
          )}
          <p className="text-[11px] text-ink-subtle">Scored by AI {relativeTime(score.scored_at)}.</p>
        </>
      ) : (
        <p className="text-[13px] text-ink-muted">Not scored yet.</p>
      )}
      <button type="button" className="btn w-full" onClick={rescore} disabled={busy}>
        <Gauge className={busy ? "animate-pulse" : ""} strokeWidth={1.75} />
        {busy ? "Scoring…" : score ? "Score again" : "Score this lead"}
      </button>
      <p className="text-[11px] text-ink-subtle">AI reads what we already know about them (never their email or phone). About half a cent.</p>
      {message && <p className="text-[12px] text-urgent">{message}</p>}
    </section>
  );
}
