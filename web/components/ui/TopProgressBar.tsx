"use client";

/**
 * ui/TopProgressBar.tsx — a thin black bar that animates the instant you click
 * an internal link, so navigation feels responsive even while the next page's
 * server data is still loading. Completes when the route (pathname) changes.
 *
 * Inputs:  usePathname() + a document-level click listener (capture phase).
 * Outputs: a 2px fixed bar at the very top edge.
 * Used by: app/(dashboard)/layout.tsx (mounted once).
 *
 * Pairs with the global loading.tsx skeleton: the bar says "something is
 * happening now"; the skeleton shows the shape of what's coming.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function TopProgressBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (trickle.current) {
      clearInterval(trickle.current);
      trickle.current = null;
    }
    if (hide.current) {
      clearTimeout(hide.current);
      hide.current = null;
    }
  }, []);

  const begin = useCallback(() => {
    clearTimers();
    setActive(true);
    setProgress(8);
    // Creep toward 90% so a long load still feels alive, but never "finishes".
    trickle.current = setInterval(() => {
      setProgress((p) => (p < 90 ? p + (90 - p) * 0.1 + 0.4 : p));
    }, 240);
  }, [clearTimers]);

  const finish = useCallback(() => {
    clearTimers();
    setProgress(100);
    hide.current = setTimeout(() => {
      setActive(false);
      setProgress(0);
    }, 260);
  }, [clearTimers]);

  // Start on any plain left-click of an internal link.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const targetAttr = anchor.getAttribute("target");
      if (!href || targetAttr === "_blank") return;
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        /^https?:\/\//.test(href)
      ) {
        return;
      }
      begin();
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [begin]);

  // Complete whenever the resolved path changes.
  useEffect(() => {
    finish();
  }, [pathname, finish]);

  // Cleanup on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-0.5 pointer-events-none"
      style={{
        opacity: active ? 1 : 0,
        transition: active ? "none" : "opacity 200ms ease 120ms",
      }}
    >
      <div
        className="h-full bg-ink"
        style={{
          width: `${progress}%`,
          transition: "width 240ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </div>
  );
}
