"use client";

/**
 * VoiceOutreachCard.tsx — Voice-outreach panel on the Lead detail page.
 *
 * Inputs:  lead { id, phone, primary_offer, secondary_offer, call_status,
 *          website_score, website_issues }
 * Outputs: offer override (PATCH), Call (POST /call), script viewer
 *          (GET /script), outcome logging (POST /call/outcome)
 * Used by: (dashboard)/leads/[id]/page.tsx
 *
 * Replaces the email "Send to outreach" action. The script is generated +
 * snapshotted server-side when the call is enqueued; a human reads it, dials,
 * and logs the result here.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneCall, FileText, ChevronDown } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { Button } from "@/components/ui/Button";

type Offer = "build_website" | "improve_website" | "voice_agent";

const OFFER_LABEL: Record<Offer, string> = {
  build_website: "Build website",
  improve_website: "Improve website",
  voice_agent: "Voice agent",
};

const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: "interested", label: "Interested" },
  { value: "callback", label: "Call back later" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "do_not_call", label: "Do not call" },
];

const DISPOSITIONS: Array<{ value: string; label: string }> = [
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left voicemail" },
];

interface Lead {
  id: string;
  phone: string | null;
  primary_offer: Offer | null;
  secondary_offer: Offer | null;
  call_status: string | null;
  website_score: number | null;
  website_issues: string[] | null;
}

export function VoiceOutreachCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [offer, setOffer] = useState<Offer>(lead.primary_offer ?? "voice_agent");
  const [savingOffer, setSavingOffer] = useState(false);
  const [calling, setCalling] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [loadingScript, setLoadingScript] = useState(false);
  const [logging, setLogging] = useState(false);

  async function saveOffer(next: Offer) {
    setOffer(next);
    setSavingOffer(true);
    const res = await fetchJson(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primary_offer: next }),
    });
    setSavingOffer(false);
    if (!res.success) toast.error(res.error);
    else router.refresh();
  }

  async function startCall() {
    if (calling) return;
    if (!lead.phone) {
      toast.warning("This lead has no phone number.");
      return;
    }
    setCalling(true);
    const res = await fetchJson<{ status: string; offer: Offer }>(`/api/leads/${lead.id}/call`, {
      method: "POST",
    });
    setCalling(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Call queued — script ready below.");
    await loadScript();
    router.refresh();
  }

  async function loadScript() {
    setLoadingScript(true);
    const res = await fetchJson<{ script_snapshot: string }>(`/api/leads/${lead.id}/script`);
    setLoadingScript(false);
    if (res.success) setScript(res.data.script_snapshot);
    else setScript(null);
  }

  async function logOutcome(body: Record<string, unknown>) {
    if (logging) return;
    setLogging(true);
    const res = await fetchJson(`/api/leads/${lead.id}/call/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLogging(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Outcome logged.");
    router.refresh();
  }

  const callStatus = lead.call_status ?? "none";
  const hasOpenCall = callStatus === "queued" || callStatus === "dialing";

  return (
    <section className="bg-white border border-rule rounded-lg p-4 space-y-4">
      <p className="text-label-caps text-ink-muted uppercase tracking-wider">Voice outreach</p>

      {/* Offer routing + override */}
      <div>
        <label className="text-[11px] text-ink-subtle font-medium block mb-1">Offer to pitch</label>
        <div className="relative">
          <select
            value={offer}
            disabled={savingOffer}
            onChange={(e) => saveOffer(e.target.value as Offer)}
            className="w-full appearance-none h-9 pl-3 pr-8 text-[13px] border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none disabled:opacity-50"
          >
            {(Object.keys(OFFER_LABEL) as Offer[]).map((o) => (
              <option key={o} value={o}>
                {OFFER_LABEL[o]}
              </option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 absolute right-2.5 top-2.5 text-ink-subtle pointer-events-none" />
        </div>
        {lead.secondary_offer && (
          <p className="text-[11px] text-ink-subtle mt-1">
            Attach offer: {OFFER_LABEL[lead.secondary_offer]}
          </p>
        )}
      </div>

      {/* Website audit summary (improve leads) */}
      {typeof lead.website_score === "number" && (
        <div className="rounded-lg bg-surface-alt border border-rule px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-subtle font-medium">Website health</span>
            <span className="mono-num text-[13px] font-semibold text-ink">{lead.website_score}/100</span>
          </div>
          {lead.website_issues && lead.website_issues.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {lead.website_issues.map((i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-warning-soft text-warning border-warning/30"
                >
                  {i.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Phone + Call */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Phone className="h-4 w-4 text-ink-subtle" strokeWidth={1.75} />
          <span className="font-mono">{lead.phone ?? "—"}</span>
          {callStatus !== "none" && (
            <span className="ml-auto text-[11px] mono-num text-ink-subtle">{callStatus.replaceAll("_", " ")}</span>
          )}
        </div>
        <Button
          variant="primary"
          className="w-full"
          onClick={startCall}
          loading={calling}
          disabled={!lead.phone}
        >
          {!calling && <PhoneCall strokeWidth={2.5} />}
          {calling ? "Preparing…" : hasOpenCall ? "Regenerate script" : "Queue call + script"}
        </Button>
        <Button
          variant="soft-action"
          className="w-full"
          onClick={loadScript}
          loading={loadingScript}
        >
          {!loadingScript && <FileText strokeWidth={2.5} />}
          {loadingScript ? "Loading…" : "View call script"}
        </Button>
      </div>

      {script && (
        <pre className="text-[12px] text-ink whitespace-pre-wrap font-sans leading-relaxed bg-surface-alt border border-rule rounded-lg p-3 max-h-72 overflow-auto">
          {script}
        </pre>
      )}

      {/* Outcome logging */}
      <div>
        <p className="text-[11px] text-ink-subtle font-medium mb-1.5">Log call outcome</p>
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              onClick={() => logOutcome({ outcome: o.value })}
              disabled={logging}
              className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-rule-strong text-ink-muted hover:bg-surface-alt disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
          {DISPOSITIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => logOutcome({ status: d.value })}
              disabled={logging}
              className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-rule text-ink-subtle hover:bg-surface-alt disabled:opacity-50"
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
