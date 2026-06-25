"use client";

/**
 * MobileNav.tsx — hamburger button + slide-in nav drawer for small screens.
 *
 * Inputs:  NAV_GROUPS (lib/nav) + current route (usePathname).
 * Outputs: a Menu button (md:hidden) in the TopBar that opens a left drawer
 *          mirroring the desktop SideNav — nav groups, Resources, and the
 *          "Take the tour" replay. Closes on navigate, backdrop tap, or Esc.
 * Used by: components/TopBar.tsx
 *
 * The desktop SideNav is `hidden md:flex`, so this is the ONLY navigation on
 * mobile. Reuses NAV_GROUPS so the two never drift.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, BookOpen, Code2, HelpCircle, Compass } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav";
import { startTour } from "@/components/onboarding/tour-store";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="md:hidden -ml-1 p-1.5 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>

      <div
        className={`fixed inset-0 z-[70] md:hidden ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-ink/45 transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Drawer */}
        <aside
          className={`absolute left-0 top-0 bottom-0 w-72 max-w-[82vw] bg-surface border-r border-rule flex flex-col shadow-xl transition-transform duration-200 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <header className="h-14 flex items-center justify-between px-4 border-b border-rule flex-shrink-0">
            <span className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-ink">
                <span className="font-display font-bold text-canvas text-[14px] leading-none">L</span>
              </span>
              <span className="font-display font-semibold text-ink text-[15px] tracking-tight">
                LeadGen Ops
              </span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="p-1.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-alt transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="eyebrow px-3 mb-2 text-ink-subtle">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "group relative flex items-center gap-3 px-3 py-2.5 rounded transition-colors",
                          active
                            ? "bg-surface-alt text-ink font-semibold"
                            : "text-ink-muted hover:bg-surface-alt hover:text-ink font-medium",
                        ].join(" ")}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-ink"
                            aria-hidden
                          />
                        )}
                        <Icon
                          className={`h-[17px] w-[17px] ${active ? "text-ink" : "text-ink-subtle group-hover:text-ink"}`}
                          strokeWidth={1.75}
                        />
                        <span className="text-[14px]">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-rule px-3 py-3 flex-shrink-0">
            <Link
              href="/manual"
              className="group flex items-center gap-3 px-3 py-2 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
            >
              <BookOpen className="h-[17px] w-[17px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
              <span className="text-[14px] font-medium">User manual</span>
            </Link>
            <a
              href="/api-docs"
              className="group flex items-center gap-3 px-3 py-2 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
            >
              <Code2 className="h-[17px] w-[17px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
              <span className="text-[14px] font-medium">API docs</span>
            </a>
            <a
              href="mailto:john@optinetsolutions.com?subject=LeadGen%20Ops%20support"
              className="group flex items-center gap-3 px-3 py-2 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
            >
              <HelpCircle className="h-[17px] w-[17px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
              <span className="text-[14px] font-medium">Support</span>
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                startTour();
              }}
              className="group w-full flex items-center gap-3 px-3 py-2 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
            >
              <Compass className="h-[17px] w-[17px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
              <span className="text-[14px] font-medium">Take the tour</span>
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
