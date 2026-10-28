"use client";

/**
 * ui/useServerTable.ts — wires a server-paged <DataTable> to URL params.
 *
 * Inputs:  the current { sort, page, per } (parsed server-side) + the row total.
 * Outputs: ServerTableProps whose callbacks push ?sort=&dir=&page=&per= while
 *          keeping every other param (filters, search). Changing sort or page
 *          size returns to page 1.
 * Used by: LeadsTable, BatchesTable.
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ServerTableProps } from "@/components/ui/DataTable";
import type { SortState } from "@/lib/table";

export function useServerTable({
  sort,
  page,
  per,
  total,
  pageSizes,
  noun,
}: {
  sort: SortState | null;
  page: number;
  per: number;
  total: number;
  pageSizes?: readonly number[];
  noun?: string;
}): ServerTableProps {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return {
    sort,
    page,
    pageSize: per,
    total,
    pageSizes,
    noun,
    onSortChange: (s) => push({ sort: s?.key, dir: s?.dir, page: undefined }),
    onPageChange: (p) => push({ page: p > 1 ? String(p) : undefined }),
    onPageSizeChange: (n) => push({ per: String(n), page: undefined }),
  };
}
