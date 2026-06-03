/**
 * (public)/layout.tsx — chrome-free shell for token-gated public pages (no dashboard nav).
 * Centers a single card; used by the one-time intake form.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-rule rounded-xl p-6 sm:p-8 shadow-sm">
        {children}
        <p className="mt-6 pt-4 border-t border-rule text-[11px] text-ink-subtle text-center">
          Optirate · this is a private link just for you
        </p>
      </div>
    </div>
  );
}
