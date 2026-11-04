/**
 * (dashboard)/crm/page.tsx — the CRM board: every lead as a card, grouped by sales stage.
 *
 * Inputs:  leads (light columns, newest-updated first, up to 1000) + migration-054 CRM fields
 * Outputs: <CrmBoard> (client) with follow-up strip, filters, drag-to-stage, side panel
 * Used by: route "/crm" (sidebar → Pipeline → CRM). Workflow: workflows/manage_crm.md
 *
 * If migration 054 is not applied yet, the page still renders (tags / follow-up / owner
 * come back empty) and shows a one-line hint.
 */
import { KanbanSquare } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { CrmBoard } from "@/components/crm/CrmBoard";
import { safeDb } from "@/lib/safe-db";
import type { CrmCard } from "@/lib/crm/board";

export const dynamic = "force-dynamic";

const BASE_COLS =
  "id,business_name,stage,phone,email,address,country_code,category,primary_offer,demo_url,screenshot_url," +
  "updated_at,inbox_status,seq_status,call_status,setup_fee,monthly_amount";
const CRM_COLS = ",tags,next_follow_up_at,assigned_to";
const LIMIT = 1000;

async function loadCards(): Promise<{ cards: CrmCard[]; crmReady: boolean }> {
  return safeDb(
    async (db) => {
      const q = (cols: string) => db.from("leads").select(cols).order("updated_at", { ascending: false }).limit(LIMIT);
      let crmReady = true;
      let { data, error } = await q(BASE_COLS + CRM_COLS);
      if (error && /tags|next_follow_up_at|assigned_to/.test(error.message)) {
        crmReady = false;
        ({ data, error } = await q(BASE_COLS));
      }
      if (error) throw new Error(error.message);
      const cards = ((data ?? []) as unknown as Partial<CrmCard>[]).map((r) => ({
        ...r,
        tags: Array.isArray(r.tags) ? r.tags : [],
        next_follow_up_at: r.next_follow_up_at ?? null,
        assigned_to: r.assigned_to ?? null,
      })) as CrmCard[];
      return { cards, crmReady };
    },
    { cards: [] as CrmCard[], crmReady: false },
  );
}

export default async function CrmPage() {
  const { cards, crmReady } = await loadCards();
  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="CRM"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{cards.length}</span> leads on the board · drag a card to move it
            {!crmReady && <span className="text-warning"> · tags, follow-ups and owner need migration 054</span>}
          </>
        }
      />
      {cards.length === 0 ? (
        <EmptyState icon={KanbanSquare} title="No leads yet" description="Run a batch and the leads land here, grouped by stage." />
      ) : (
        <CrmBoard initialCards={cards} crmReady={crmReady} />
      )}
    </div>
  );
}
