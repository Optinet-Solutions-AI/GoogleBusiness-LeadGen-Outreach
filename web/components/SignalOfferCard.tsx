"use client";

/**
 * SignalOfferCard.tsx — right-rail panel for closure/layoff signal leads (inventory offer).
 *
 * Inputs:  lead id, email, primary_offer
 * Outputs: POST /api/leads/[id]/email (single verification-gated email); no Build / no sequence
 * Used by: app/(dashboard)/leads/[id]/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";

export function SignalOfferCard({
  leadId,
  email,
  primaryOffer,
}: {
  leadId: string;
  email: string | null;
  primaryOffer: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = primaryOffer === "buy_inventory" ? "Email (inventory offer)" : "Email";

  async function send() {
    setBusy(true);
    const res = await fetchJson<{ sent?: boolean; skipped?: string; noop?: boolean }>(`/api/leads/${leadId}/email`, {
      method: "POST",
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error, { title: "Email" });
      return;
    }
    if (res.data.sent) toast.success("Email sent.");
    else toast.warning(res.data.skipped ?? "Email not sent (no mailbox connected or address not verified).");
    router.refresh();
  }

  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <p className="eyebrow mb-2">Closure outreach</p>
      <p className="text-[12px] text-ink-muted mb-3">
        This business filed a closure/layoff notice. We never build it a website — email the remaining-inventory
        offer instead. Sends only to a verified address.
      </p>
      <Button variant="primary" className="w-full" onClick={send} loading={busy} disabled={!email}>
        {!busy && <Mail strokeWidth={2.5} />} {label}
      </Button>
      {!email && <p className="mt-2 text-[11px] text-ink-subtle">Add an email on the Contact card first.</p>}
    </section>
  );
}
