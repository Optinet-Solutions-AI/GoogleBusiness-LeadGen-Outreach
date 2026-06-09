/**
 * nav.ts — single source of truth for dashboard navigation.
 *
 * Inputs:  none (static config)
 * Outputs: grouped nav structure (NAV_GROUPS), a flat list (NAV_ITEMS), and a
 *          pageTitle(pathname) lookup for the top-bar breadcrumb.
 * Used by: components/SideNav.tsx (renders the groups) + components/TopBar.tsx
 *          (current page title). Keeping it here means the sidebar, the top-bar
 *          title, and any future command palette never drift out of sync.
 */

import {
  LayoutDashboard,
  Layers,
  UserSearch,
  Megaphone,
  MessageSquareText,
  BarChart3,
  LineChart,
  Mail,
  Share2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Today", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: LineChart },
      { href: "/status", label: "Status", icon: BarChart3 },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { href: "/batches", label: "Batches", icon: Layers },
      { href: "/leads", label: "Leads", icon: UserSearch },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/inbox", label: "Inbox", icon: MessageSquareText },
      { href: "/email-accounts", label: "Email", icon: Mail },
      { href: "/social", label: "Social", icon: Share2 },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Best-match page title for a pathname (longest matching href wins). */
export function pageTitle(pathname: string | null): string {
  if (!pathname || pathname === "/") return "Today";
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    if (item.href === "/") continue;
    if (pathname === item.href || pathname.startsWith(item.href)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.label ?? "";
}
