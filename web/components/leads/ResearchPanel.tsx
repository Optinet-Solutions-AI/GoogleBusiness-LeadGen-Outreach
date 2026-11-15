/**
 * leads/ResearchPanel.tsx — "AI Lookup" results under the Contact card, one line per finding, each with
 * Verify and Remove.
 *
 * Inputs:  lead id, the saved research (leads.ai_profile + when), the lead's current email / phone / owner / page
 * Outputs: POST /api/leads/:id/ai-profile/decide { key, action } → router.refresh()
 * Used by: app/(dashboard)/leads/[id]/page.tsx (below <ContactCard>)
 *
 * Dumb client: the lines and their states come from lib/leads/research-review.ts (pure). Verify on an email / phone
 * makes it the main one (the old one is kept under More emails / phones); on the owner or contact page it saves
 * it; on anything else it just marks it checked. Remove hides the line.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { reviewRows, type CurrentContact, type ResearchView, type ReviewRow } from "@/lib/leads/research-review";

const STATE_CHIP: Record<ReviewRow["state"], { text: string; cls: string }> = {
  in_use: { text: "In use", cls: "bg-positive-soft text-positive" },
  verified: { text: "Checked", cls: "bg-action-soft text-action" },
  new: { text: "New", cls: "bg-warning-soft text-warning" },
};

function verifyTitle(r: ReviewRow): string {
  if (r.kind === "email" || r.kind === "phone") return `Use this as the main ${r.kind}. The current one is kept under More ${r.kind}s.`;
  if (r.kind === "owner") return "Save this as the contact person.";
  if (r.kind === "contact_page") return "Save this as their contact page.";
  return "Mark this as checked.";
}

export function ResearchPanel({
  leadId,
  research,
  current,
}: {
  leadId: string;
  research: { profile: ResearchView; createdAt: string };
  current: CurrentContact;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const p = research.profile;
  const rows = reviewRows(p, current);

  async function decide(r: ReviewRow, action: "verify" | "remove") {
    if (busyKey) return;
    setBusyKey(`${r.key}:${action}`);
    const res = await fetchJson<{ message: string }>(`/api/leads/${leadId}/ai-profile/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: r.key, action }),
    });
    setBusyKey(null);
    if (!res.success) toast.error(res.error, { title: "Didn't work" });
    else toast.success(res.data.message);
    router.refresh();
  }

  const made = new Date(research.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="bg-surface border border-rule rounded-lg p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="eyebrow">AI Lookup</p>
        <span className="text-[11px] text-ink-subtle">Found {made}</span>
      </div>
      <p className="text-[11px] text-ink-subtle mb-3">
        Found with OpenAI web search and a scan of their website (public pages only). AI can get things wrong, so check
        each detail before you use it.
      </p>

      {p.summary && <p className="text-[13px] text-ink leading-relaxed mb-3">{p.summary}</p>}
      {rows.length === 0 && !p.summary && <p className="text-[13px] text-ink-muted">Nothing public found, or every detail was removed.</p>}

      {rows.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1 text-[13px]">
                <span className="font-semibold text-ink">{r.label}:</span>{" "}
                {r.text && <span className={cx("text-ink break-words", (r.kind === "email" || r.kind === "phone") && "mono-num")}>{r.text}</span>}
                {r.links?.map((l, i) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-action hover:underline break-all">
                    {i > 0 ? ", " : ""}
                    {l.label}
                  </a>
                ))}
              </div>
              <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none flex-none mt-0.5", STATE_CHIP[r.state].cls)}>
                {STATE_CHIP[r.state].text}
              </span>
              <div className="flex gap-1 flex-none">
                {r.state !== "in_use" && r.state !== "verified" && (
                  <button
                    type="button"
                    onClick={() => decide(r, "verify")}
                    disabled={!!busyKey}
                    title={verifyTitle(r)}
                    className="inline-flex items-center gap-1 rounded border border-rule px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-positive-soft hover:text-positive disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} /> {busyKey === `${r.key}:verify` ? "…" : "Verify"}
                  </button>
                )}
                {r.state !== "in_use" && (
                  <button
                    type="button"
                    onClick={() => decide(r, "remove")}
                    disabled={!!busyKey}
                    title="Remove this from the research results (nothing on the lead changes)"
                    className="inline-flex items-center rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-subtle hover:bg-urgent-soft hover:text-urgent disabled:opacity-50"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {p.sources.length > 0 && (
        <div className="mt-2 text-[11px] text-ink-muted">
          <button type="button" onClick={() => setShowSources((v) => !v)} className="underline underline-offset-2 hover:text-ink">
            {showSources ? "Hide sources" : `Where this came from (${p.sources.length})`}
          </button>
          {showSources && (
            <ul className="mt-1.5 space-y-0.5">
              {p.sources.map((s) => (
                <li key={s}>
                  <a href={s} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline break-all">
                    {s.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3 flex-none" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
