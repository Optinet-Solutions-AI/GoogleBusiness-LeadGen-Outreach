/**
 * (dashboard)/test-call/page.tsx — Agent editor + in-browser test call.
 *
 * Renders the AgentEditor (edit system prompt + voice, save) above the
 * VapiTestCall widget so the operator can tune and immediately test the agent.
 */
import { AgentEditor } from "@/components/AgentEditor";
import { VapiTestCall } from "@/components/VapiTestCall";

export const dynamic = "force-dynamic";

export default function TestCallPage() {
  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-2">Outreach</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">Agent</h1>
        <p className="text-[13px] text-ink-muted mt-2">
          Edit the prompt + voice, save, then test — talking to the assistant in your browser.
        </p>
      </header>
      <AgentEditor />
      <hr className="border-rule mb-6" />
      <VapiTestCall />
    </div>
  );
}
