/**
 * (dashboard)/loading.tsx — instant skeleton while a dashboard page's server data loads.
 *
 * App Router streams this immediately on every navigation (the sidebar stays put), so a
 * click feels instant instead of a blank/frozen wait until all Supabase queries finish.
 * One file here is the Suspense fallback for ALL routes under (dashboard).
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* header */}
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-surface-alt" />
        <div className="h-9 w-56 rounded bg-surface-alt" />
      </div>

      {/* stat-card row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-rule bg-surface" />
        ))}
      </div>

      {/* hero / funnel block */}
      <div className="h-48 rounded-lg border border-rule bg-surface" />

      {/* table */}
      <div className="rounded-lg border border-rule bg-surface overflow-hidden">
        <div className="h-10 bg-surface-alt border-b border-rule" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 border-b border-rule last:border-0" />
        ))}
      </div>
    </div>
  );
}
