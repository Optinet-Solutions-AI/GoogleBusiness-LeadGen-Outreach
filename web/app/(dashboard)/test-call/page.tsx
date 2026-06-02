/**
 * (dashboard)/test-call/page.tsx — In-app browser test call to the Vapi assistant.
 *
 * Renders the client-side VapiTestCall widget so the operator can talk to the live agent
 * (mic + transcript) without dialing a real number — works from anywhere.
 */
import { VapiTestCall } from "@/components/VapiTestCall";

export const dynamic = "force-dynamic";

export default function TestCallPage() {
  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-2">Outreach</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">Test call</h1>
        <p className="text-[13px] text-ink-muted mt-2">
          Talk to the voice agent in your browser to test its script + delivery — free, no phone number.
        </p>
      </header>
      <VapiTestCall />
    </div>
  );
}
