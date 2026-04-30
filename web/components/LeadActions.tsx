"use client";

/**
 * LeadActions.tsx — right-rail action panel on the Lead detail page.
 * Owns: email edit, meeting buttons, ImproveModal toggle, HandoverModal toggle,
 * and the danger-zone close-as-lost / dead buttons.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  MessageSquarePlus,
  Building,
  Pencil,
  ArrowRight,
  Hammer,
  RefreshCw,
  XCircle,
  Send,
} from "lucide-react";
import { ImproveModal } from "./ImproveModal";
import { HandoverModal } from "./HandoverModal";
import { fetchJson } from "@/lib/fetch-json";

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
  const [building, setBuilding] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [sendingOutreach, setSendingOutreach] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    const res = await fetchJson(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.success) alert(res.error);
    return res;
  }

  async function postMeeting(status: "booked" | "done") {
    const res = await fetchJson(`/api/leads/${lead.id}/meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes: meetingNotes || undefined }),
    });
    if (!res.success) {
      alert(res.error);
      return;
    }
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

  async function buildSite() {
    if (building) return;
    if (!confirm("Build the website for this lead? This calls the Gemini API + creates a Cloudflare Pages project. ~30s.")) return;
    setBuilding(true);
    const triggered = await fetchJson(`/api/leads/${lead.id}/build`, { method: "POST" });
    if (!triggered.success) {
      alert(triggered.error);
      setBuilding(false);
      return;
    }
    // Poll until stage flips to 'deployed' or last_error is set, max 90s.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const j = await fetchJson<{ stage: string; last_error: string | null }>(
        `/api/leads/${lead.id}`,
      );
      if (!j.success) continue;
      if (j.data.stage === "deployed") break;
      if (j.data.last_error) break;
    }
    setBuilding(false);
    router.refresh();
  }

  async function rebuildSite() {
    if (rebuilding) return;
    if (!confirm("Re-run generate + deploy on the latest template/code? Doesn't change the lead's stage. ~30–60s.")) return;
    setRebuilding(true);
    const previousDemoUrl = lead.demo_url;
    const triggered = await fetchJson(`/api/leads/${lead.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_stage: "generate" }),
    });
    if (!triggered.success) {
      alert(triggered.error);
      setRebuilding(false);
      return;
    }
    // Cloud Run regenerate doesn't flip `stage`, but stage 4 always writes a
    // fresh `demo_url` (new Cloudflare deploy hash) — poll on that change.
    // Cap at ~120s so the UI doesn't spin forever if the job got stuck.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const j = await fetchJson<{ demo_url: string | null; last_error: string | null }>(
        `/api/leads/${lead.id}`,
      );
      if (!j.success) continue;
      if (j.data.last_error) break;
      if (j.data.demo_url && j.data.demo_url !== previousDemoUrl) break;
    }
    setRebuilding(false);
    router.refresh();
  }

  async function skipLead() {
    if (skipping) return;
    if (!confirm("Skip this lead? Marks it as 'dead' so the dashboard hides it.")) return;
    setSkipping(true);
    await patch({ stage: "dead" });
    setSkipping(false);
    router.refresh();
  }

  async function sendOutreach() {
    if (sendingOutreach) return;
    if (!lead.email) {
      alert("Add an email before sending outreach.");
      return;
    }
    const verb = lead.stage === "outreached" ? "Resend" : "Send";
    if (!confirm(`${verb} the demo link to ${lead.email} via Instantly?`)) return;
    setSendingOutreach(true);
    const res = await fetchJson<{ status: "outreached" | "needs_email" }>(
      `/api/leads/${lead.id}/outreach`,
      { method: "POST" },
    );
    setSendingOutreach(false);
    if (!res.success) {
      alert(res.error);
      return;
    }
    if (res.data.status === "needs_email") {
      alert("Lead has no email on file — add one and try again.");
    }
    router.refresh();
  }

  const isHandedOver = lead.stage === "handed_over" && !!lead.custom_domain;
  const canBuild = ["scraped", "enriched", "generated"].includes(lead.stage);
  const canSkip = !["closed_won", "handed_over", "dead"].includes(lead.stage);
  const canSendOutreach = ["deployed", "needs_email", "outreached"].includes(lead.stage);
  // Rebuild = regenerate stage 3+4 on the latest template/code without
  // touching `stage`. Available once a site exists (post-Build) and until
  // the lead is closed out / handed off.
  const canRebuild =
    !!lead.demo_url &&
    !["dead", "closed_won", "closed_lost", "handed_over"].includes(lead.stage);

  return (
    <aside className="space-y-6 lg:sticky lg:top-16">
      {/* Build / Skip — operator review gate */}
      {(canBuild || canSkip) && (
        <Section label={canBuild ? "Build website" : "Triage"}>
          {canBuild && (
            <>
              <p className="text-[12px] text-slate-500 mb-3">
                Lead currently at <span className="font-mono text-slate-700">{lead.stage}</span>.
                Click to run enrich → generate → deploy. Sends nothing — that&apos;s a separate step.
              </p>
              <button
                onClick={buildSite}
                disabled={building}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-brand text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                <Hammer className="h-4 w-4" strokeWidth={2.5} />
                {building ? "Building… (~30s)" : "Build website"}
              </button>
            </>
          )}
          {canSkip && (
            <button
              onClick={skipLead}
              disabled={skipping}
              className={[
                "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-50",
                canBuild ? "mt-2 bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-rose-100 text-rose-700 hover:bg-rose-200",
              ].join(" ")}
            >
              <XCircle className="h-4 w-4" strokeWidth={2.5} />
              {skipping ? "Skipping…" : "Skip this lead"}
            </button>
          )}
        </Section>
      )}

      {/* Email + outreach trigger */}
      <Section label="Contact">
        <div className="space-y-3">
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

          {canSendOutreach && !editingEmail && (
            <button
              onClick={sendOutreach}
              disabled={sendingOutreach || !lead.email}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-sm font-semibold hover:bg-amber-200 disabled:opacity-50"
            >
              <Send className="h-4 w-4" strokeWidth={2.5} />
              {sendingOutreach
                ? "Sending…"
                : lead.stage === "outreached"
                  ? "Resend outreach"
                  : "Send to outreach"}
            </button>
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

      {/* Rebuild — refresh template/code without flipping stage. Used when
          a template/code change has shipped and we want this lead's demo
          to pick it up. NOT for adding the customer's real data — that's
          the Improve form below. */}
      {canRebuild && (
        <Section label="Rebuild site">
          <p className="text-[12px] text-slate-500 mb-2">
            Re-run generate + deploy on the latest template + code. Doesn&apos;t change the lead&apos;s stage.
          </p>
          <button
            onClick={rebuildSite}
            disabled={rebuilding}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${rebuilding ? "animate-spin" : ""}`} />
            {rebuilding ? "Rebuilding… (~30–60s)" : "Rebuild on latest template"}
          </button>
        </Section>
      )}

      {/* Improve */}
      <Section label="Improve site">
        <p className="text-[12px] text-slate-500 mb-2">Rebuild with the customer&apos;s real photos, hours, and copy edits. Marks the lead as &apos;improved&apos;.</p>
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
