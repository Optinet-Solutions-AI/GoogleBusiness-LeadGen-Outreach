/**
 * ClientTabs.tsx — tab pills for the client detail page (driven by ?tab=).
 *
 * Inputs:  active tab id + the active tab's panel as children
 * Outputs: Link pills + the panel
 * Used by: app/(dashboard)/clients/[id]/page.tsx
 */

import Link from "next/link";
import { cx } from "@/lib/cx";

export const TAB_IDS = ["overview", "brain", "products", "posts", "assets", "intake", "history"] as const;
export type TabId = (typeof TAB_IDS)[number];

const LABEL: Record<TabId, string> = {
  overview: "Overview",
  brain: "Brain",
  products: "Products",
  posts: "Posts",
  assets: "Assets",
  intake: "Intake",
  history: "History",
};

export function ClientTabs({ active, children }: { active: TabId; children: React.ReactNode }) {
  return (
    <div>
      <nav className="flex flex-wrap gap-1.5 mb-5" aria-label="Client sections">
        {TAB_IDS.map((t) => (
          <Link
            key={t}
            href={`?tab=${t}`}
            className={cx(
              "px-3 py-1.5 rounded-full text-[12.5px] border",
              t === active
                ? "bg-ink text-surface border-ink font-medium"
                : "bg-surface text-ink-muted border-rule hover:text-ink",
            )}
          >
            {LABEL[t]}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
