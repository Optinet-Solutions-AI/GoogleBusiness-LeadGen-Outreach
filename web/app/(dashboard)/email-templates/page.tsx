/**
 * (dashboard)/email-templates/page.tsx — saved email templates with version history (Outreach → Templates).
 *
 * Inputs:  nothing (the client loads /api/email-templates)
 * Outputs: the page shell: EmailResults (which emails get replies + wording tests, 24 Nov 2026) above
 *          TemplatesClient (list, editor, history, restore, archive)
 * Used by: route "/email-templates"
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { TemplatesClient } from "@/components/templates/TemplatesClient";
import { EmailResults } from "@/components/templates/EmailResults";

export const dynamic = "force-dynamic";

export default function EmailTemplatesPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Email templates"
        subtitle="Saved emails for Send email. Every save keeps the old version, so you can see what changed and restore it."
      />
      <EmailResults />
      <TemplatesClient />
    </div>
  );
}
