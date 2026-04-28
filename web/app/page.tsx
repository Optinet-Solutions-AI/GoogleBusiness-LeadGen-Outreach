/**
 * page.tsx — Placeholder landing page.
 *
 * The real operator dashboard goes here. See web/README.md for the page list,
 * UX outline, and API contract.
 */

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Lead-Gen Pipeline</h1>
      <p className="mt-3 text-zinc-600">
        Operator dashboard placeholder. The API is live at{" "}
        <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-sm">/api/*</code> — try{" "}
        <a className="text-blue-600 underline" href="/api/health">/api/health</a> or{" "}
        <a
          className="text-blue-600 underline"
          href="/api/pricing/compare?limit=100"
        >
          /api/pricing/compare?limit=100
        </a>
        .
      </p>
      <p className="mt-3 text-sm text-zinc-500">See <code>web/README.md</code> to build the dashboard.</p>
    </main>
  );
}
