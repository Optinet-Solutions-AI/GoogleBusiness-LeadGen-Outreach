"use client";

/**
 * ui/FilterSelect.tsx — a labeled dropdown filter for list pages. Sets one URL
 * param (preserving the others) when an option is picked. Display-only: reads
 * the active value + sibling params from props and navigates on select.
 *
 * A custom popover (not a native <select>) so the open option list matches the
 * dashboard styling — rounded, padded, branded active row — instead of the
 * unstyleable OS menu.
 *
 * Inputs:  label, param (url key), value ("" = All), options, basePath, current.
 * Outputs: router.push to the next URL on select.
 * Used by: dashboard list pages via <FilterBar>.
 */
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { cx } from "@/lib/cx";
import { buildFilterUrl } from "@/lib/url-params";

export function FilterSelect({
  label,
  param,
  value,
  options,
  basePath,
  current,
}: {
  label: string;
  param: string;
  value: string;
  options: { value: string; label: string }[];
  basePath: string;
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (v: string) => {
    setOpen(false);
    router.push(buildFilterUrl(basePath, current, { [param]: v || undefined }));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-surface pl-2.5 pr-2 py-1.5 text-[12px] hover:border-rule-strong transition-colors"
      >
        <span className="text-ink-subtle">{label}</span>
        <span className="font-semibold text-ink">{activeLabel}</span>
        <ChevronDown
          className={cx("h-3.5 w-3.5 text-ink-subtle transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-rule bg-surface p-1 shadow-elev"
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(o.value)}
                className={cx(
                  "flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  selected
                    ? "bg-action-soft text-action font-semibold"
                    : "text-ink hover:bg-surface-alt",
                )}
              >
                <span>{o.label}</span>
                {selected && <Check className="h-3.5 w-3.5 flex-none" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
