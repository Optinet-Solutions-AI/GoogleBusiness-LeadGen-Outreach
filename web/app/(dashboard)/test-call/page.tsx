/**
 * (dashboard)/test-call/page.tsx — Agent editor + in-browser test call.
 *
 * Two columns: edit the prompt/intro/voice on the left, talk to the agent on the right.
 * The call panel is sticky and self-scrolling so a long conversation never pushes the page.
 */
import { AgentEditor } from "@/components/AgentEditor";
import { VapiTestCall } from "@/components/VapiTestCall";
import { SavedTestCalls } from "@/components/SavedTestCalls";

export const dynamic = "force-dynamic";

export default function TestCallPage() {
  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-2">Outreach</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">Agent</h1>
        <p className="text-[13px] text-ink-muted mt-2">
          Edit the intro, prompt + voice on the left, then talk to the agent on the right.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        <AgentEditor />
        <div className="lg:sticky lg:top-6">
          <VapiTestCall />
        </div>
      </div>

      <SavedTestCalls />
    </div>
  );
}
