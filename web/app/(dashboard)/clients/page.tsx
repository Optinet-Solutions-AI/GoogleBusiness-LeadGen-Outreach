/**
 * (dashboard)/clients/page.tsx — Clients list (Brand Brain).
 *
 * Inputs:  listClients() via safeDb
 * Outputs: a table — name | status | sources | version | last built | cost
 * Used by: route "/clients"
 */

import { Briefcase } from "lucide-react";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { listClients, type ClientListRow } from "@/lib/clients/clients";
import { ClientsTable } from "@/components/ClientsTable";
import { NewClientButton } from "@/components/NewClientButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load clients.</p>
      </div>
    );
  }

  const clients = await safeDb(() => listClients(), [] as ClientListRow[]);

  return (
    <div>
      <PageHeader
        eyebrow="Clients"
        title="Clients"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{clients.length}</span>{" "}
            {clients.length === 1 ? "client" : "clients"}
          </>
        }
        actions={<NewClientButton />}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No clients yet"
          description="No clients yet. Make one from a lead, or add one by name."
        />
      ) : (
        <ClientsTable rows={clients} />
      )}
    </div>
  );
}
