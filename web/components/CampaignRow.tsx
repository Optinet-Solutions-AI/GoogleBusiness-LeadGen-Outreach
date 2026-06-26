"use client";

/**
 * CampaignRow.tsx — a fully clickable campaign table row.
 *
 * Inputs:  href (campaign detail) + the row's <td> cells as children
 * Outputs: navigates to href on row click (anywhere), keyboard-accessible
 * Used by: (dashboard)/campaigns/page.tsx
 *
 * The whole row is the click target (not just the name link), so the operator
 * can click anywhere on a campaign to open it.
 */

import { useRouter } from "next/navigation";

export function CampaignRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      tabIndex={0}
      className="hover:bg-surface-alt transition-colors cursor-pointer focus:outline-none focus:bg-surface-alt"
    >
      {children}
    </tr>
  );
}
