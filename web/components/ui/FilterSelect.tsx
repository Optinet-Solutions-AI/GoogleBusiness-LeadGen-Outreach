"use client";

/**
 * ui/FilterSelect.tsx — a labeled native <select> that filters a list page by
 * setting one URL param while preserving the others. Display-only: it reads the
 * active value + sibling params from props and navigates on change.
 *
 * Inputs:  label, param (url key), value ("" = All), options, basePath, current.
 * Outputs: router.push to the next URL on change.
 * Used by: dashboard list pages via <FilterBar>.
 */
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
  return (
    <div className="relative inline-flex items-center gap-1.5 rounded-md border border-rule bg-surface pl-2.5 pr-7 py-1.5 text-[12px] hover:border-rule-strong transition-colors">
      <span className="text-ink-subtle">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) =>
          router.push(buildFilterUrl(basePath, current, { [param]: e.target.value || undefined }))
        }
        className="appearance-none bg-transparent font-semibold text-ink cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-ink-subtle" aria-hidden />
    </div>
  );
}
