/**
 * (dashboard)/test-list/page.tsx — the Test list: who may receive test sends while Test mode is on (26 Nov 2026).
 *
 * Inputs:  nothing (the client loads /api/test-mode)
 * Outputs: the page shell around TestListClient (instructions, the list, add / remove)
 * Used by: route "/test-list" (sidebar, and the Test mode banner's link). Workflow: workflows/use_test_mode.md
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { TestListClient } from "@/components/TestListClient";

export const dynamic = "force-dynamic";

export default function TestListPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Testing"
        title="Test list"
        subtitle="While Test mode is on, emails, contact forms and AI calls only reach the people on this list. Add your own email and phone before you test."
      />
      <TestListClient />
    </div>
  );
}
