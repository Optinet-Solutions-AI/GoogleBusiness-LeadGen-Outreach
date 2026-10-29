"use client";

/**
 * DataTable.tsx — reusable interactive table: search, filter, sort, paginate.
 *
 * - One scroll container (vertical + horizontal); header is sticky top-0 inside
 *   it, so it stays visible while the body scrolls (and never detaches/overlaps).
 * - Columns drag-to-reorder like a spreadsheet; order persists per browser via
 *   localStorage keyed by `storageKey`.
 * - Click a sortable header to sort (asc → desc → off).
 * - Optional leading checkbox column for row selection (fixed, not draggable).
 *
 * Two modes:
 *   client (default) — rows are the full set; search (`search`), column filters
 *     (`column.filter`), sort (`column.sortValue`) and paging all run here.
 *   server (`server` prop) — rows are already one page; the parent owns sort +
 *     paging (URL params) and renders its own filter bar. Sortable columns set
 *     `sortable: true`.
 *
 * Each table defines its own columns (with render fns) in a client wrapper and
 * passes them here; this owns only the mechanics.
 */

import { useEffect, useMemo, useState } from "react";
import { useDragScroll } from "@/components/ui/useDragScroll";
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical, Search } from "lucide-react";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";
import { Pagination } from "@/components/ui/Pagination";
import {
  PAGE_SIZES,
  matchesSearch,
  nextSort,
  paginate,
  sortRows,
  type SortState,
  type SortValue,
} from "@/lib/table";

export interface DataColumnFilter<T> {
  /** Toolbar label; defaults to the column label. */
  label?: string;
  /** The row's value for this filter ("" / null = no value). */
  value: (row: T) => string | null | undefined;
  /** Fixed options. When omitted, built from the distinct values in the rows. */
  options?: SelectOption[];
  /** Display label for a derived option value. */
  labelFor?: (value: string) => string;
}

export interface DataColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Tailwind width/min-width class applied to header + cells. */
  width?: string;
  render: (row: T) => React.ReactNode;
  /** Client mode: the value to sort by. Its presence makes the header sortable. */
  sortValue?: (row: T) => SortValue;
  /** Server mode: the server can sort by this column's key. */
  sortable?: boolean;
  /** Client mode: adds a dropdown filter for this column to the toolbar. */
  filter?: DataColumnFilter<T>;
}

export interface SelectionProps {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
}

export interface ServerTableProps {
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  page: number;
  pageSize: number;
  total: number;
  pageSizes?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  noun?: string;
}

const ALL = "__all__";
const NONE = "__none__";

function reconcile<T>(saved: string[], columns: DataColumn<T>[]): string[] {
  const known = columns.map((c) => c.key);
  const kept = saved.filter((k) => known.includes(k));
  const missing = known.filter((k) => !kept.includes(k));
  return [...kept, ...missing];
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  storageKey,
  onRowClick,
  rowClassName,
  selection,
  empty,
  minWidth = "min-w-[680px]",
  maxHeight = "max-h-[calc(100vh-13rem)]",
  search,
  pageSizes = PAGE_SIZES,
  defaultPageSize,
  noun = "rows",
  server,
  toolbarExtra,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
  storageKey: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  selection?: SelectionProps;
  empty?: React.ReactNode;
  minWidth?: string;
  maxHeight?: string;
  /** Client mode: adds a search box matching against `text(row)`. */
  search?: { placeholder?: string; text: (row: T) => string };
  pageSizes?: readonly number[];
  defaultPageSize?: number;
  /** What the rows are called in the footer ("leads", "batches"). */
  noun?: string;
  /** Server mode: the parent owns sort + paging. */
  server?: ServerTableProps;
  /** Extra controls rendered at the end of the client toolbar. */
  toolbarExtra?: React.ReactNode;
}) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useDragScroll(scrollEl);
  const [order, setOrder] = useState<string[]>(columns.map((c) => c.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Client-mode view state.
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize ?? pageSizes[0] ?? 25);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setOrder(reconcile(JSON.parse(raw) as string[], columns));
      else setOrder(columns.map((c) => c.key));
      const size = Number(localStorage.getItem(`${storageKey}.pageSize`));
      if (!server && pageSizes.includes(size)) setPageSize(size);
    } catch {
      setOrder(columns.map((c) => c.key));
    }
    // columns are static per table; key off storageKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function persist(next: string[]) {
    setOrder(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function onDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    const next = [...order];
    next.splice(next.indexOf(dragKey), 1);
    next.splice(next.indexOf(targetKey), 0, dragKey);
    persist(next);
    setDragKey(null);
    setOverKey(null);
  }

  const cols = order.map((k) => columns.find((c) => c.key === k)).filter((c): c is DataColumn<T> => !!c);
  const colCount = cols.length + (selection ? 1 : 0);
  const filterCols = server ? [] : columns.filter((c) => c.filter);

  // Options for each client filter: fixed, or the distinct values present.
  const filterOptions = useMemo(() => {
    const out: Record<string, SelectOption[]> = {};
    for (const c of filterCols) {
      const f = c.filter!;
      let opts = f.options;
      if (!opts) {
        const values = new Set<string>();
        let hasEmpty = false;
        for (const r of rows) {
          const v = f.value(r);
          if (v === null || v === undefined || v === "") hasEmpty = true;
          else values.add(v);
        }
        opts = [...values]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((v) => ({ value: v, label: f.labelFor ? f.labelFor(v) : v }));
        if (hasEmpty) opts.push({ value: NONE, label: "(none)" });
      }
      out[c.key] = [{ value: ALL, label: "All" }, ...opts];
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  // Client pipeline: search → filters → sort → page.
  const view = useMemo(() => {
    if (server) return null;
    let out = rows;
    if (search && query.trim()) out = out.filter((r) => matchesSearch(search.text(r), query));
    for (const c of filterCols) {
      const want = filters[c.key];
      if (!want || want === ALL) continue;
      out = out.filter((r) => {
        const v = c.filter!.value(r);
        if (want === NONE) return v === null || v === undefined || v === "";
        return v === want;
      });
    }
    const sortCol = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    if (sort && sortCol) out = sortRows(out, sortCol.sortValue!, sort.dir);
    return paginate(out, page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, query, filters, sort, page, pageSize, server]);

  const visibleRows = server ? rows : view!.rows;
  const activeSort = server ? server.sort : sort;
  const filtering = !server && (query.trim() !== "" || Object.values(filters).some((v) => v && v !== ALL));

  function isSortable(c: DataColumn<T>): boolean {
    return server ? !!c.sortable : !!c.sortValue;
  }

  function clickSort(key: string) {
    const next = nextSort(activeSort, key);
    if (server) server.onSortChange(next);
    else {
      setSort(next);
      setPage(1);
    }
  }

  function changePageSize(size: number) {
    if (server) return server.onPageSizeChange(size);
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(`${storageKey}.pageSize`, String(size));
    } catch {
      /* ignore */
    }
  }

  function clearAll() {
    setQuery("");
    setFilters({});
    setPage(1);
  }

  const showToolbar = !server && (!!search || filterCols.length > 0 || !!toolbarExtra);
  // Client footer only once there's more than one small page worth of rows.
  const showClientFooter = !server && (rows.length > (pageSizes[0] ?? 25) || (view?.pageCount ?? 1) > 1);

  return (
    <div>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {search && (
            <div className="relative inline-flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-ink-subtle" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={search.placeholder ?? "Search…"}
                aria-label={search.placeholder ?? "Search"}
                className="rounded-md border border-rule bg-surface pl-8 pr-3 py-1.5 text-[12px] text-ink placeholder:text-ink-subtle hover:border-rule-strong focus:border-action min-w-[200px]"
              />
            </div>
          )}
          {filterCols.map((c) => (
            <SelectMenu
              key={c.key}
              label={c.filter!.label ?? c.label}
              value={filters[c.key] ?? ALL}
              options={filterOptions[c.key] ?? []}
              onChange={(v) => {
                setFilters((prev) => ({ ...prev, [c.key]: v }));
                setPage(1);
              }}
            />
          ))}
          {filtering && (
            <>
              <span className="text-[12px] text-ink-muted">
                <span className="mono-num text-ink font-semibold">{view?.total ?? 0}</span> of{" "}
                <span className="mono-num">{rows.length}</span>
              </span>
              <button
                type="button"
                onClick={clearAll}
                className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Clear
              </button>
            </>
          )}
          {toolbarExtra}
        </div>
      )}

      <div ref={setScrollEl} className={`bg-surface border border-rule rounded-lg overflow-auto ${maxHeight}`}>
        <table className={`w-full ${minWidth} text-left border-collapse`}>
          <thead className="sticky top-0 z-20 bg-surface-alt">
            <tr className="border-b border-rule">
              {selection && (
                <th className="px-3 py-3 w-9">
                  <input
                    type="checkbox"
                    checked={selection.allSelected}
                    onChange={selection.onToggleAll}
                    aria-label="Select all"
                    className="cursor-pointer"
                  />
                </th>
              )}
              {cols.map((c) => {
                const sortable = isSortable(c);
                const dir = activeSort?.key === c.key ? activeSort.dir : null;
                const SortIcon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
                return (
                  <th
                    key={c.key}
                    draggable
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                    onDragStart={() => setDragKey(c.key)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (overKey !== c.key) setOverKey(c.key);
                    }}
                    onDrop={() => onDrop(c.key)}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    className={[
                      "group/th px-4 py-3 text-label-caps uppercase tracking-[0.18em] text-ink-muted select-none cursor-grab active:cursor-grabbing whitespace-nowrap",
                      c.align === "right" ? "text-right" : "text-left",
                      c.width ?? "",
                      overKey === c.key && dragKey && dragKey !== c.key ? "bg-action-soft" : "",
                      dragKey === c.key ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                      <GripVertical className="h-3 w-3 text-ink-subtle opacity-0 group-hover/th:opacity-100" strokeWidth={2} />
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => clickSort(c.key)}
                          title="Sort"
                          className={`inline-flex items-center gap-1 uppercase tracking-[0.18em] hover:text-ink ${dir ? "text-ink" : ""}`}
                        >
                          {c.label}
                          <SortIcon
                            className={`h-3 w-3 ${dir ? "text-action" : "text-ink-subtle opacity-50 group-hover/th:opacity-100"}`}
                            strokeWidth={2}
                            aria-hidden
                          />
                        </button>
                      ) : (
                        c.label
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-[13px] text-ink-muted">
                  {filtering ? (
                    <>
                      Nothing matches your search or filters.{" "}
                      <button type="button" onClick={clearAll} className="underline underline-offset-2 hover:text-ink">
                        Clear
                      </button>
                    </>
                  ) : (
                    empty ?? "Nothing to show."
                  )}
                </td>
              </tr>
            )}
            {visibleRows.map((row) => {
              const id = getRowId(row);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={[
                    "transition-colors",
                    onRowClick ? "cursor-pointer hover:bg-surface-alt" : "hover:bg-surface-alt",
                    rowClassName?.(row) ?? "",
                  ].join(" ")}
                >
                  {selection && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selection.selected.has(id)}
                        onChange={() => selection.onToggle(id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Select row"
                        className="cursor-pointer"
                      />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""} ${c.width ?? ""}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {server ? (
        <ServerFooter server={server} />
      ) : (
        showClientFooter &&
        view && (
          <Pagination
            page={view.page}
            pageCount={view.pageCount}
            total={view.total}
            from={view.from}
            to={view.to}
            pageSize={pageSize}
            pageSizes={pageSizes}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
            noun={noun}
          />
        )
      )}
    </div>
  );
}

function ServerFooter({ server }: { server: ServerTableProps }) {
  const pageCount = Math.max(1, Math.ceil(server.total / server.pageSize));
  const page = Math.min(Math.max(1, server.page), pageCount);
  const from = server.total ? (page - 1) * server.pageSize + 1 : 0;
  const to = Math.min(server.total, page * server.pageSize);
  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      total={server.total}
      from={from}
      to={to}
      pageSize={server.pageSize}
      pageSizes={server.pageSizes ?? PAGE_SIZES}
      onPageChange={server.onPageChange}
      onPageSizeChange={server.onPageSizeChange}
      noun={server.noun}
    />
  );
}
