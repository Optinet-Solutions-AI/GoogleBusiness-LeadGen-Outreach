"use client";

/**
 * useDragScroll.ts — click-and-drag to pan a scroll container (horizontal + vertical).
 *
 * Inputs:  the scrollable element (pass it from a callback ref so the hook re-binds when it mounts)
 * Outputs: mouse handlers on that element; a drag starts only after 5px of movement and
 *          never from interactive elements (inputs, buttons, links, draggable headers),
 *          and the click that ends a drag is swallowed so rows aren't opened by accident
 * Used by: components/ui/DataTable.tsx
 */
import { useEffect } from "react";

const INTERACTIVE = "input, button, a, select, textarea, label, [draggable='true'], [role='button']";
const THRESHOLD = 5;

export function useDragScroll(el: HTMLElement | null): void {
  useEffect(() => {
    if (!el) return;
    let startX = 0, startY = 0, left = 0, top = 0;
    let pressed = false, dragging = false;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      pressed = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      left = el.scrollLeft;
      top = el.scrollTop;
    };
    const onMove = (e: MouseEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging && Math.abs(dx) + Math.abs(dy) < THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      el.scrollLeft = left - dx;
      el.scrollTop = top - dy;
      e.preventDefault();
    };
    const end = () => {
      if (!pressed) return;
      pressed = false;
      el.style.cursor = "";
      el.style.userSelect = "";
      if (dragging) {
        // Swallow the click that follows a drag so a row isn't opened.
        const stop = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener("click", stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
      }
      dragging = false;
    };

    el.style.cursor = "grab";
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", end);
    return () => {
      el.style.cursor = "";
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", end);
    };
  }, [el]);
}
