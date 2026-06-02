"use client";

/**
 * SideNav.tsx — fixed 224px left rail.
 *
 * Inputs:  none (reads route via usePathname)
 * Outputs: white sidebar, 1px right rule, indigo left-edge accent on the
 *          active item + indigo-soft fill, neutral hover state elsewhere.
 *          Two sections: Operations (primary nav) + Resources (external).
 * Used by: (dashboard)/layout.tsx
 *
 * Per the Operator Clinical Light brief: the ONLY accent color in the
 * sidebar is indigo on the active item. Hover is a faint surface-alt fill.
 * No legacy ember dot.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  UserSearch,
  PhoneCall,
  Megaphone,
  MessageSquareText,
  BarChart3,
  LineChart,
  HelpCircle,
  FileText,
  Mail,
} from "lucide-react";

const PRIMARY = [
  { href: "/",               label: "Today",          icon: LayoutDashboard },
  { href: "/batches",        label: "Batches",        icon: Layers },
  { href: "/leads",          label: "Leads",          icon: UserSearch },
  { href: "/calls",          label: "Call queue",     icon: PhoneCall },
  { href: "/campaigns",      label: "Campaigns",      icon: Megaphone },
  { href: "/replies",        label: "Replies",        icon: MessageSquareText },
  { href: "/analytics",      label: "Analytics",      icon: LineChart },
  { href: "/email-accounts", label: "Email accounts", icon: Mail },
  { href: "/status",         label: "Status",         icon: BarChart3 },
];

const SECONDARY = [
  {
    href: "https://github.com/Optinet-Solutions-AI/GoogleBusiness-LeadGen-Outreach/tree/main/docs",
    label: "Docs",
    icon: FileText,
    external: true,
  },
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
    <aside className="fixed left-0 top-14 bottom-0 w-56 bg-surface border-r border-rule hidden md:flex flex-col py-5">
      <div className="px-5 mb-4">
        <p className="eyebrow">Operations</p>
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "group relative flex items-center gap-3 px-3 py-2 rounded transition-colors",
                active
                  ? "bg-action-soft text-action"
                  : "text-ink-muted hover:bg-surface-alt hover:text-ink",
              ].join(" ")}
            >
              {active && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-action"
                  aria-hidden
                />
              )}
              <Icon
                className={`h-[15px] w-[15px] ${active ? "text-action" : "text-ink-subtle group-hover:text-ink"}`}
                strokeWidth={1.75}
              />
              <span className={`text-[13px] ${active ? "font-semibold" : "font-medium"}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-2 pt-4 border-t border-rule">
        <p className="eyebrow px-3 mb-2">Resources</p>
        {SECONDARY.map(({ href, label, icon: Icon, external }) => (
          <a
            key={href}
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="group flex items-center gap-3 px-3 py-2 text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors rounded"
          >
            <Icon className="h-[15px] w-[15px] text-ink-subtle group-hover:text-ink" strokeWidth={1.75} />
            <span className="text-[13px] font-medium">{label}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}
