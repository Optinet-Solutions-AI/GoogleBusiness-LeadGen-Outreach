"use client";

/**
 * ui/FilterSelect.tsx — a labeled dropdown filter for list pages. Sets one URL
 * param (preserving the others) when an option is picked. Display-only: reads
 * the active value + sibling params from props and navigates on select.
 *
 * Renders the shared <SelectMenu> popover (not a native <select>) so the open
 * option list matches the dashboard styling.
 *
 * Inputs:  label, param (url key), value ("" = All), options, basePath, current.
 * Outputs: router.push to the next URL on select.
 * Used by: dashboard list pages via <FilterBar>.
 */
import { useRouter } from "next/navigation";
import { buildFilterUrl } from "@/lib/url-params";
import { SelectMenu } from "@/components/ui/SelectMenu";

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
    <SelectMenu
      label={label}
      value={value}
      options={options}
      onChange={(v) => router.push(buildFilterUrl(basePath, current, { [param]: v || undefined }))}
    />
  );
}
