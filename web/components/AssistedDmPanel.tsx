"use client";

/**
 * AssistedDmPanel.tsx — compliant, manual DM helper for social-page leads.
 *
 * Inputs:  { leadId, businessName, profileUrl, platformLabel, primaryOffer }
 * Outputs: Copy message → clipboard; Open profile → their social; Mark DM sent →
 *          POST /api/leads/[id]/dm (logs the event, advances stage).
 * Used by: lead detail page (right column) + inbox thread, for social/DM leads.
 *
 * Meta blocks automated cold DMs, so this is operator-assisted: we draft the
 * message and open their profile; you paste + send by hand, then mark it sent.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { renderDmMessage, type DmOffer } from "@/lib/dm-message";

export function AssistedDmPanel({
  leadId,
  businessName,
  profileUrl,
  platformLabel,
  primaryOffer,
}: {
  leadId: string;
  businessName: string;
  profileUrl: string | null;
  platformLabel: string;
  primaryOffer?: DmOffer;
}) {
  const router = useRouter();
  const [message, setMessage] = useState(() => renderDmMessage(businessName, primaryOffer ?? null));
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.trim());
      setCopied(true);
      toast.success("Message copied — paste it into their DMs.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the text and copy manually.");
    }
  }

  async function markSent() {
    setMarking(true);
    const res = await fetchJson<{ logged: boolean }>(`/api/leads/${leadId}/dm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim() }),
    });
    setMarking(false);
    if (!res.success) {
      toast.error(res.error, { title: "Couldn't log DM" });
      return;
    }
    toast.success("Logged as DM sent.");
    router.refresh();
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow text-ink-muted">Assisted DM</p>
        <span className="text-[10px] uppercase tracking-[0.14em] font-mono text-ink-subtle">
          {platformLabel}
        </span>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="w-full px-3 py-2 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none resize-y"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check strokeWidth={2.5} /> : <Copy strokeWidth={2} />}
          {copied ? "Copied" : "Copy message"}
        </Button>
        {profileUrl && (
          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Open {platformLabel}
            <ExternalLink strokeWidth={1.75} />
          </a>
        )}
        <Button variant="primary" size="sm" onClick={markSent} loading={marking} className="ml-auto">
          Mark DM sent
        </Button>
      </div>

      <p className="text-[11px] text-ink-subtle leading-relaxed">
        Paste the message into their DMs and send by hand. {platformLabel} doesn&apos;t allow
        automated cold DMs, so this keeps your account safe.
      </p>
    </section>
  );
}
