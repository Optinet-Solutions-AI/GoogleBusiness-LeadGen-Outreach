"use client";

/**
 * LeadActions.tsx — right-rail action panel on the Lead detail page.
 * Owns: email edit, meeting buttons, ImproveModal toggle, HandoverModal toggle,
 * and the danger-zone close-as-lost / dead buttons.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, CheckCircle2, MessageSquarePlus, Building, Pencil, ArrowRight } from "lucide-react";
import { ImproveModal } from "./ImproveModal";
import { HandoverModal } from "./HandoverModal";

interface Lead {
  id: string;
  email: string | null;
  stage: string;
  demo_url: string | null;
  custom_domain: string | null;
  handover_mode: string | null;
}

export function LeadActions({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [email, setEmail] = useState(lead.email ?? "");
  const [editingEmail, setEditingEmail] = useState(!lead.email);
  const [savingEmail, setSavingEmail] = useState(false);

  const [meetingNotes, setMeetingNotes] = useState("");
  const [improveOpen, setImproveOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async function postMeeting(status: "booked" | "done") {
    await fetch(`/api/leads/${lead.id}/meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes: meetingNotes || undefined }),
    });
    setMeetingNotes("");
    router.refresh();
  }

  async function saveEmail() {
    if (!email) return;
    setSavingEmail(true);
    await patch({ email });
    setSavingEmail(false);
    setEditingEmail(false);
    router.refresh();
  }

  async function setStage(stage: string) {
    if (!confirm(`Mark as ${stage}?`)) return;
    await patch({ stage });
    router.refresh();
  }

  const isHandedOver = lead.stage === "handed_over" && !!lead.custom_domain;

  return (
    <aside className="space-y-6 lg:sticky lg:top-16">
      {/* Email */}
      <Section label="Contact">
        <div className="space-y-2">
          {editingEmail ? (
            <div className="flex gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@business.com"
                type="email"
                className="flex-1 h-9 px-3 text-body-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
              />
              <button
                onClick={saveEmail}
                disabled={savingEmail}
                className="px-4 py-2 rounded-full bg-brand text-white text-sm font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-slate-700">{lead.email}</span>
              <button onClick={() => setEditingEmail(true)} className="text-slate-400 hover:text-slate-700">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* Meeting */}
      <Section label="Meeting">
        <textarea
          value={meetingNotes}
          onChange={(e) => setMeetingNotes(e.target.value)}
          rows={2}
          placeholder="Optional notes (call time, agreed scope…)"
          className="w-full p-2.5 text-body-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none resize-y"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => postMeeting("booked")}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-violet-100 text-violet-700 text-sm font-semibold hover:bg-violet-200"
          >
            <Calendar className="h-3.5 w-3.5" /> Mark booked
          </button>
          <button
            onClick={() => postMeeting("done")}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark done
          </button>
        </div>
      </Section>

      {/* Improve */}
      <Section label="Improve site">
        <p className="text-[12px] text-slate-500 mb-2">Rebuild with the customer&apos;s real photos, hours, and copy edits.</p>
        <button
          onClick={() => setImproveOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-cyan-100 text-cyan-700 text-sm font-semibold hover:bg-cyan-200"
        >
          <MessageSquarePlus className="h-4 w-4" /> Open improve form
        </button>
      </Section>

      {/* Handover */}
      <Section label="Hand over">
        {isHandedOver ? (
          <div className="text-sm rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800">
            Live on <span className="font-mono font-semibold">{lead.custom_domain}</span>
            {lead.handover_mode === "transfer" && <span className="ml-1 text-emerald-600">(transferred)</span>}
          </div>
        ) : (
          <button
            onClick={() => setHandoverOpen(true)}
            disabled={!lead.demo_url}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 disabled:opacity-50"
          >
            <Building className="h-4 w-4" /> Attach customer domain
          </button>
        )}
      </Section>

      {/* Danger zone */}
      <details className="group bg-slate-50 border border-slate-200 rounded-lg">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-label-caps text-slate-500 uppercase tracking-wider">
          Close out
          <ArrowRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        </summary>
        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={() => setStage("closed_won")}
            className="w-full px-3 py-2 rounded-full bg-emerald-600 text-white text-sm font-semibold hover:opacity-90"
          >
            Closed — won
          </button>
          <button
            onClick={() => setStage("closed_lost")}
            className="w-full px-3 py-2 rounded-full bg-rose-100 text-rose-700 text-sm font-semibold hover:bg-rose-200"
          >
            Closed — lost
          </button>
          <button
            onClick={() => setStage("dead")}
            className="w-full px-3 py-2 rounded-full bg-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-300"
          >
            Mark dead
          </button>
        </div>
      </details>

      {improveOpen && <ImproveModal leadId={lead.id} onClose={() => setImproveOpen(false)} />}
      {handoverOpen && <HandoverModal leadId={lead.id} onClose={() => setHandoverOpen(false)} />}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-label-caps text-slate-500 uppercase tracking-wider mb-3">{label}</p>
      {children}
    </section>
  );
}
