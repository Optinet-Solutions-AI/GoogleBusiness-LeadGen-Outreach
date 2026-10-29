/**
 * (dashboard)/clients/[id]/page.tsx — Client detail (Brand Brain): tabbed workspace.
 *
 * Inputs:  client, sources, profile/draft, versions, last job via safeDb; ?tab=
 * Outputs: header + ClientTabs with the active tab's panel
 * Used by: route "/clients/[id]"
 */

import { notFound } from "next/navigation";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { getClient, getLatestJob } from "@/lib/clients/clients";
import { listSources } from "@/lib/clients/sources";
import { listAssets } from "@/lib/clients/assets";
import { diffPaths } from "@/lib/clients/facts";
import { getCurrentProfile, getDraft, listVersions, snapshotProducts } from "@/lib/clients/profile";
import { PageHeader } from "@/components/ui/PageHeader";
import { ClientTabs, TAB_IDS, type TabId } from "@/components/clients/ClientTabs";
import { ClientOverview } from "@/components/clients/ClientOverview";
import { ClientIntakeForm } from "@/components/clients/ClientIntakeForm";
import { BrainEditor } from "@/components/clients/BrainEditor";
import { DraftReview } from "@/components/clients/DraftReview";
import { VersionHistory } from "@/components/clients/VersionHistory";
import { ProductsPanel } from "@/components/clients/ProductsPanel";
import { AssetsPanel } from "@/components/clients/AssetsPanel";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  pilot: "text-ink",
  active: "text-positive",
  paused: "text-warning",
  churned: "text-ink-muted",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <p className="text-[13px] text-ink-muted">Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load this client.</p>
      </div>
    );
  }

  const id = params.id;
  const [client, sources, profile, draft, versions, lastJob, assets, products] = await safeDb(
    () =>
      Promise.all([
        getClient(id),
        listSources(id),
        getCurrentProfile(id),
        getDraft(id),
        listVersions(id),
        getLatestJob(id),
        listAssets(id),
        snapshotProducts(id),
      ]),
    [null, [], null, null, [], null, [], []] as never,
  );
  if (!client) notFound();

  const tab: TabId = (TAB_IDS as readonly string[]).includes(searchParams.tab ?? "")
    ? (searchParams.tab as TabId)
    : "overview";
  const operator = sources.find((s) => s.kind === "operator");

  let panel: React.ReactNode;
  switch (tab) {
    case "overview":
      panel = <ClientOverview client={client} sources={sources} lastJob={lastJob} hasProfile={!!(profile || draft)} />;
      break;
    case "intake":
      panel = <ClientIntakeForm clientId={id} initial={operator?.intake ?? null} />;
      break;
    case "history":
      panel = <VersionHistory clientId={id} versions={versions} currentVersion={profile?.version ?? null} />;
      break;
    case "brain":
      panel = (
        <>
          {draft && (
            <DraftReview
              clientId={id}
              current={profile}
              draft={draft}
              diffPaths={profile ? diffPaths(profile.data, draft.data) : []}
            />
          )}
          <BrainEditor
            key={`${client.current_version}:${profile?.version ?? 0}`}
            clientId={id}
            clientVersion={client.current_version}
            current={profile}
            assets={assets}
          />
        </>
      );
      break;
    case "products":
      panel = <ProductsPanel clientId={id} products={products} assets={assets} />;
      break;
    default:
      panel = <AssetsPanel clientId={id} assets={assets} logoAssetId={profile?.data.visuals.logo_asset_id ?? null} />;
  }
  return renderPage(panel);

  function renderPage(content: React.ReactNode) {
    return (
      <div>
        <PageHeader
          eyebrow={`Clients / ${id.slice(0, 8)}`}
          title={client!.name}
          subtitle={
            <span
              className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt capitalize ${STATUS_TONE[client!.status] ?? "text-ink-muted"}`}
            >
              {client!.status}
            </span>
          }
        />
        <ClientTabs active={tab}>{content}</ClientTabs>
      </div>
    );
  }
}
