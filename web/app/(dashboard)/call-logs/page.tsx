/**
 * (dashboard)/call-logs/page.tsx — Outreach → Call logs: listen to and download our AI calls (19 Nov 2026).
 *
 * Inputs:  nothing (the client loads /api/calls)
 * Outputs: the page shell around CallLogsClient
 * Used by: route "/call-logs"
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { CallLogsClient } from "@/components/calls/CallLogsClient";

export const dynamic = "force-dynamic";

export default function CallLogsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Call logs"
        subtitle="Every AI call we placed: listen, read the transcript, download. Kept here only, never in Voizo's reports."
      />
      <CallLogsClient />
    </div>
  );
}
