/**
 * (dashboard)/email-templates/page.tsx — saved email templates with version history (Outreach → Templates).
 *
 * Inputs:  nothing (the client loads /api/email-templates)
 * Outputs: the page shell around TemplatesClient (list, editor, history, restore, archive)
 * Used by: route "/email-templates"
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { TemplatesClient } from "@/components/templates/TemplatesClient";

export const dynamic = "force-dynamic";

export default function EmailTemplatesPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Email templates"
        subtitle="Saved emails for Send email. Every save keeps the old version, so you can see what changed and restore it."
      />
      <TemplatesClient />
    </div>
  );
}
