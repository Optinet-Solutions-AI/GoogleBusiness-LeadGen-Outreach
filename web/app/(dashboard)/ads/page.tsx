/**
 * (dashboard)/ads/page.tsx — competitor Ad Library: pulled Meta ads, filters, pull requests, "make our version".
 *
 * Inputs:  searchParams { media?, saved?, q?, pull? } → listAds; listPulls; listClients (for the remake picker)
 * Outputs: <AdLibrary> (client)
 * Used by: route "/ads" (sidebar → Clients → Ad Library). Workflow: workflows/build_ad_library.md
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { AdLibrary } from "@/components/ads/AdLibrary";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { listAds, type AdRow } from "@/lib/ads/library";
import { listPulls, type PullRow } from "@/lib/ads/pulls";
import { listClients } from "@/lib/clients/clients";
import { env } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function AdsPage({ searchParams }: { searchParams: { media?: string; saved?: string; q?: string; pull?: string } }) {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load the Ad Library.</p>
      </div>
    );
  }
  const media: "video" | "image" | undefined = searchParams.media === "video" ? "video" : searchParams.media === "image" ? "image" : undefined;
  const filters = { media, saved: searchParams.saved === "1", q: searchParams.q?.trim() || undefined, pull: searchParams.pull || undefined };
  const [ads, pulls, clients] = await Promise.all([
    safeDb(() => listAds(filters), [] as AdRow[]),
    safeDb(() => listPulls(), [] as PullRow[]),
    safeDb(async () => (await listClients()).map((c) => ({ id: c.id, name: c.name })), [] as { id: string; name: string }[]),
  ]);
  const savedCount = ads.filter((a) => a.saved).length;
  return (
    <div>
      <PageHeader
        eyebrow="Clients"
        title="Ad Library"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{ads.length}</span> competitor ads
            {savedCount > 0 && <> · <span className="mono-num text-ink font-semibold">{savedCount}</span> saved</>}
            {" · "}pulled from the Meta Ad Library at about ${env.APIFY_ADS_USD_PER_AD.toFixed(3)} per ad
          </>
        }
      />
      <AdLibrary ads={ads} pulls={pulls} clients={clients} filters={filters} usdPerAd={env.APIFY_ADS_USD_PER_AD} maxPerPull={env.ADS_MAX_PER_PULL} />
    </div>
  );
}
