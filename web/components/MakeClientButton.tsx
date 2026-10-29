"use client";

/**
 * MakeClientButton.tsx — "Make client" / "Open client" action on the lead page.
 *
 * Inputs:  leadId, clientId (null when the lead has not been made a client yet).
 * Outputs: POST /api/leads/:id/client then navigates to /clients/<id>; or a link
 *          to the existing client. No business logic — the route is idempotent.
 * Used by: app/(dashboard)/leads/[id]/page.tsx
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function MakeClientButton({ leadId, clientId }: { leadId: string; clientId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (clientId) {
    return (
      <Link href={`/clients/${clientId}`} className="btn btn-secondary">
        <Briefcase strokeWidth={1.75} aria-hidden />
        Open client
      </Link>
    );
  }

  async function make() {
    setBusy(true);
    try {
      const res = await fetchJson<{ client_id: string; created: boolean }>(
        `/api/leads/${leadId}/client`,
        { method: "POST" },
      );
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(res.data.created ? "Client created" : "Client already exists");
      router.push(`/clients/${res.data.client_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not make client");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="primary" loading={busy} onClick={make}>
      <Briefcase strokeWidth={1.75} aria-hidden />
      Make client
    </Button>
  );
}
