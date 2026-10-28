"use client";

/**
 * ui/Pagination.tsx — table footer: "26–50 of 132", rows-per-page, prev/next.
 *
 * Inputs:  page, pageCount, total, from, to, pageSize, pageSizes, callbacks.
 * Outputs: onPageChange(page) / onPageSizeChange(size).
 * Used by: ui/DataTable (client paging) and server-paged list tables (leads, batches).
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SelectMenu } from "@/components/ui/SelectMenu";

export function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  pageSize,
  pageSizes = [25, 50, 100],
  onPageChange,
  onPageSizeChange,
  noun = "rows",
}: {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  pageSize: number;
  pageSizes?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  noun?: string;
}) {
  const btn =
    "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rule bg-surface text-ink-muted hover:text-ink hover:border-rule-strong disabled:opacity-40 disabled:pointer-events-none transition-colors";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-[12px] text-ink-muted">
      <span>
        {total === 0 ? (
          `No ${noun}`
        ) : (
          <>
            <span className="mono-num text-ink font-semibold">
              {from}–{to}
            </span>{" "}
            of <span className="mono-num text-ink font-semibold">{total}</span> {noun}
          </>
        )}
      </span>
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <SelectMenu
            label="Rows"
            value={String(pageSize)}
            options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => onPageSizeChange(Number(v))}
            align="right"
          />
        )}
        <span className="mono-num">
          Page {page} of {pageCount}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className={btn} onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
