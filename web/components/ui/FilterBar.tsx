/**
 * ui/FilterBar.tsx — one quiet, wrapping row of filter controls for list pages.
 * Replaces stacked rows of pills. Layout-only (server-compatible).
 *
 * Inputs:  children (FilterSelect / SearchInput), optional className.
 * Outputs: a flex-wrap row with consistent bottom margin.
 * Used by: dashboard list pages.
 */
import * as React from "react";
import { cx } from "@/lib/cx";

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap items-center gap-2 mb-6", className)}>{children}</div>;
}
