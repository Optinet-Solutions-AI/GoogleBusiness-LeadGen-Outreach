"use client";

/**
 * SocialDmRow.tsx — one row in the Social DM worklist.
 *
 * Inputs:  lead identity + profile link + whether a DM was already logged
 * Outputs: "Copy & open" (copies the message + opens their profile) and
 *          "Mark sent" (POST /api/leads/[id]/dm → logs it, advances stage)
 * Used by: app/(dashboard)/social/page.tsx
 *
 * Compliant assisted send: you paste into the DM by hand, then mark it sent.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Copy, Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { renderDmMessage, type DmOffer } from "@/lib/dm-message";

export interface SocialLead {
  id: string;
  business_name: string;
  place: string;
  profile_url: string | null;
  platform_label: string;
  primary_offer: DmOffer;
}

export function SocialDmRow({ lead, initialSent }: { lead: SocialLead; initialSent: boolean }) {
  const router = useRouter();
  const [sent, setSent] = useState(initialSent);
  const [marking, setMarking] = useState(false);

  const message = renderDmMessage(lead.business_name, lead.primary_offer);

  function copyAndOpen() {
    // Fire clipboard write (don't await) so window.open stays in the user gesture.
    navigator.clipboard?.writeText(message).catch(() => undefined);
    if (lead.profile_url) window.open(lead.profile_url, "_blank", "noopener");
    toast.success("Message copied — paste it into their DMs.");
  }

  async function markSent() {
    setMarking(true);
    const res = await fetchJson<{ logged: boolean }>(`/api/leads/${lead.id}/dm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setMarking(false);
    if (!res.success) {
      toast.error(res.error, { title: "Couldn't log DM" });
      return;
    }
    setSent(true);
    toast.success("Logged as DM sent.");
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-surface-alt transition-colors">
      <div className="min-w-0 flex-1">
        <Link href={`/leads/${lead.id}`} className="text-[14px] font-semibold text-ink hover:text-action truncate block">
          {lead.business_name}
        </Link>
        <div className="text-[11px] text-ink-subtle truncate">
          <span className="uppercase tracking-wide font-mono mr-1.5">{lead.platform_label}</span>
          {lead.place}
        </div>
      </div>

      {sent ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-positive flex-none">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> DM sent
        </span>
      ) : (
        <span className="text-[11px] text-ink-subtle flex-none">pending</span>
      )}

      <div className="flex items-center gap-2 flex-none">
        {lead.profile_url && (
          <Button variant="secondary" size="sm" onClick={copyAndOpen}>
            <Copy strokeWidth={2} /> Copy &amp; open
          </Button>
        )}
        {lead.profile_url && (
          <a href={lead.profile_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" aria-label="Open profile">
            <ExternalLink strokeWidth={1.75} />
          </a>
        )}
        <Button variant={sent ? "ghost" : "primary"} size="sm" onClick={markSent} loading={marking}>
          {sent ? "Sent again" : "Mark sent"}
        </Button>
      </div>
    </li>
  );
}
