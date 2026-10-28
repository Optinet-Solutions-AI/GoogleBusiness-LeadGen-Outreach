"use client";

/**
 * ui/SelectMenu.tsx — labeled dropdown ("Status  All ▾") with a styled popover
 * list. Purely presentational: reports the picked value via onChange.
 *
 * Inputs:  label, value ("" = first/All option), options, onChange.
 * Outputs: onChange(value) when an option is picked.
 * Used by: ui/FilterSelect (URL filters) and ui/DataTable (in-table filters + page size).
 */
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cx } from "@/lib/cx";

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectMenu({
  label,
  value,
  options,
  onChange,
  align = "left",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  align?: "left" | "right";
}) {
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
        <span className="font-semibold text-ink max-w-[180px] truncate">{activeLabel}</span>
        <ChevronDown
          className={cx("h-3.5 w-3.5 text-ink-subtle transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className={cx(
            "absolute top-full z-50 mt-1 min-w-[200px] max-h-[320px] overflow-auto rounded-lg border border-rule bg-surface p-1 shadow-elev",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setOpen(false);
                  onChange(o.value);
                }}
                className={cx(
                  "flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  selected ? "bg-action-soft text-action font-semibold" : "text-ink hover:bg-surface-alt",
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
