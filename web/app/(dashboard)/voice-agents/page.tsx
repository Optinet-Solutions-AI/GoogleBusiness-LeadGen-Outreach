/**
 * (dashboard)/voice-agents/page.tsx — the Voizo scripts the operator can pick in Call with AI (Outreach → Voice agents).
 *
 * Inputs:  nothing (the client loads /api/voice-agents)
 * Outputs: the page shell around VoiceAgentsClient (add, edit, default, archive)
 * Used by: route "/voice-agents"
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { VoiceAgentsClient } from "@/components/voice/VoiceAgentsClient";

export const dynamic = "force-dynamic";

export default function VoiceAgentsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Voice agents"
        subtitle="The Voizo scripts you can pick in Call with AI. Build and test them in Voizo's Script Builder, then add them here by their script id."
      />
      <VoiceAgentsClient />
    </div>
  );
}
