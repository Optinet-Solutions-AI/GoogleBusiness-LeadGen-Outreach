"use client";

/**
 * SideNav.tsx — fixed 224px left rail.
 *
 * Inputs:  NAV_GROUPS (from lib/nav) + current route (usePathname)
 * Outputs: white sidebar, 1px right rule. Nav is split into labelled GROUPS
 *          (Overview / Pipeline / Outreach). Active item: black left-edge bar +
 *          surface-alt fill + black text. A Resources row + a user/workspace
 *          block pin to the bottom.
 * Used by: (dashboard)/layout.tsx
 *
 * High-contrast monochrome: the only "accent" is ink (black) on the active item.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, HelpCircle, BookOpen, Code2, Compass } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav";
import { startTour } from "@/components/onboarding/tour-store";
import { InboxUnreadBadge } from "@/components/inbox/InboxUnreadBadge";

// Nav hrefs the guided tour spotlights, mapped to their data-tour key.
const TOUR_TARGETS: Record<string, string> = {
  "/batches": "nav-batches",
  "/leads": "nav-leads",
  "/campaigns": "nav-campaigns",
};

// In-app page (App Router) — rendered with <Link>, gets the active highlight.
const RESOURCE_PAGES = [{ href: "/manual", label: "User manual", icon: BookOpen }];

// Anchors — /api-docs is a full-page Route Handler (same origin, hard load);
// Support is an external mailto. Both rendered with a plain <a>.
const RESOURCE_ANCHORS = [
  { href: "/api-docs", label: "API docs", icon: Code2, external: false },
  {
    href: "mailto:john@optinetsolutions.com?subject=LeadGen%20Ops%20support",
    label: "Support",
    icon: HelpCircle,
    external: true,
  },
];

export function SideNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <aside className="fixed left-0 top-14 bottom-0 w-56 bg-surface border-r border-rule hidden md:flex flex-col">
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
                    data-tour={TOUR_TARGETS[href]}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "group relative flex items-center gap-3 px-3 py-2 rounded transition-colors",
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
                      className={`h-[15px] w-[15px] ${active ? "text-ink" : "text-ink-subtle group-hover:text-ink"}`}
                      strokeWidth={1.75}
                    />
                    <span className="text-[13px]">{label}</span>
                    {href === "/inbox" && <InboxUnreadBadge />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Resources — in-app guides + external links */}
      <div data-tour="resources" className="border-t border-rule px-3 py-2.5">
        {RESOURCE_PAGES.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={[
                "group flex items-center gap-3 px-3 py-1.5 transition-colors rounded",
                active
                  ? "bg-surface-alt text-ink font-semibold"
                  : "text-ink-muted hover:text-ink hover:bg-surface-alt font-medium",
              ].join(" ")}
            >
              <Icon
                className={`h-[15px] w-[15px] ${active ? "text-ink" : "text-ink-subtle group-hover:text-ink"}`}
                strokeWidth={1.75}
              />
              <span className="text-[13px]">{label}</span>
            </Link>
          );
        })}
        {RESOURCE_ANCHORS.map(({ href, label, icon: Icon, external }) => (
          <a
            key={href}
            href={href}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="group flex items-center gap-3 px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors rounded"
          >
            <Icon className="h-[15px] w-[15px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
            <span className="text-[13px] font-medium">{label}</span>
          </a>
        ))}
        <button
          type="button"
          onClick={startTour}
          className="group w-full flex items-center gap-3 px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors rounded"
        >
          <Compass className="h-[15px] w-[15px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
          <span className="text-[13px] font-medium">Take the tour</span>
        </button>
      </div>

      {/* User / workspace */}
      <div className="border-t border-rule px-3 py-3 flex items-center gap-2.5">
        <span className="h-8 w-8 flex-shrink-0 rounded bg-ink text-canvas flex items-center justify-center font-display font-semibold text-[13px] leading-none">
          J
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink truncate leading-tight">John</p>
          <p className="text-[11px] text-ink-subtle truncate leading-tight">RateUp</p>
        </div>
        <button
          type="button"
          aria-label="Settings"
          className="p-1.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-alt transition-colors"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}
