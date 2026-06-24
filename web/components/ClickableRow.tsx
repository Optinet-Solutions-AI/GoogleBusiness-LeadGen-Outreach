"use client";

/**
 * ClickableRow.tsx — a table <tr> whose whole body navigates to `href`.
 *
 * Inputs:  href (destination), children (the <td> cells, rendered server-side)
 * Outputs: client-side navigation on row click / Enter
 * Used by: (dashboard)/batches/[id]/page.tsx — the lead table
 *
 * Clicks that land on a real link/button inside the row (Google profile, demo
 * URL, the chevron) are left alone — only "empty" row clicks navigate.
 */

import { useRouter } from "next/navigation";

export function ClickableRow({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();

  function navigate() {
    router.push(href);
  }

  return (
    <tr
      onClick={(e) => {
        // Don't hijack clicks on nested interactive elements.
        if ((e.target as HTMLElement).closest("a,button")) return;
        navigate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate();
      }}
      tabIndex={0}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  );
}
