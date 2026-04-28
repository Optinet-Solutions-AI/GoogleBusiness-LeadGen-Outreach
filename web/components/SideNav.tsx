"use client";

/**
 * SideNav.tsx — fixed 240px left rail. Highlights the active route.
 * Matches Stitch design: white-bg active state with 2px brand-color left border.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, UserSearch, MessageSquareText, BarChart3, HelpCircle, FileText } from "lucide-react";

const PRIMARY = [
  { href: "/", label: "Batches", icon: Layers },
  { href: "/leads", label: "Leads", icon: UserSearch },
  { href: "/replies", label: "Replies", icon: MessageSquareText },
  { href: "/status", label: "Status", icon: BarChart3 },
];

const SECONDARY = [
  { href: "/docs", label: "Docs", icon: FileText },
  { href: "/support", label: "Support", icon: HelpCircle },
];

export function SideNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <aside className="fixed left-0 top-12 bottom-0 w-60 bg-slate-50 border-r border-slate-200 hidden md:flex flex-col py-4">
      <div className="px-4 mb-6">
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">Operations</p>
        <p className="text-[11px] text-slate-500">Lead Pipeline</p>
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href as never}
              className={[
                "flex items-center gap-3 px-3 py-2 rounded-r transition-all",
                active
                  ? "bg-white border-l-2 border-brand text-brand font-medium"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
              ].join(" ")}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              <span className="text-[13px]">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-2 border-t border-slate-200 pt-4">
        {SECONDARY.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all rounded"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            <span className="text-[13px]">{label}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}
