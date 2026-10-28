/**
 * table.ts — pure search / filter / sort / paginate helpers for dashboard tables.
 *
 * Inputs:  row arrays + accessor fns (client tables), or raw URL params (server tables).
 * Outputs: the visible page of rows + totals; parsed { sort, dir, page, per } state.
 * Used by: components/ui/DataTable (client mode) and the server-paged list pages
 *          (leads, batches). Framework-free so it unit-tests cleanly.
 */

export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean | null | undefined;

export interface SortState {
  key: string;
  dir: SortDir;
}

export const PAGE_SIZES = [25, 50, 100] as const;

/** Compare two cell values. Empty values always sort last, whichever direction. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  let c: number;
  if (typeof a === "number" && typeof b === "number") c = a - b;
  else if (typeof a === "boolean" && typeof b === "boolean") c = Number(a) - Number(b);
  else c = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? c : -c;
}

/** Stable sort by one accessor. Returns a new array. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => compareValues(value(x.row), value(y.row), dir) || x.i - y.i)
    .map((x) => x.row);
}

/** Case-insensitive "every word appears somewhere" match. Empty query matches all. */
export function matchesSearch(haystack: string, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const h = haystack.toLowerCase();
  return words.every((w) => h.includes(w));
}

/** Next sort state when a header is clicked: asc → desc → off. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

export interface PageSlice<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number; // 1-based index of the first visible row (0 when empty)
  to: number;
}

/** Slice one page, clamping the page into range. */
export function paginate<T>(rows: T[], page: number, pageSize: number): PageSlice<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (p - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return { rows: slice, page: p, pageCount, total, from: total ? start + 1 : 0, to: start + slice.length };
}

/** Page count + visible range for a server-paged table. */
export function pageInfo(total: number, page: number, pageSize: number): Omit<PageSlice<never>, "rows"> {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  const start = (p - 1) * pageSize;
  return { page: p, pageCount, total, from: total ? start + 1 : 0, to: Math.min(total, start + pageSize) };
}

export interface ServerTableParams {
  sort: SortState | null;
  page: number;
  per: number;
}

/**
 * Parse ?sort=&dir=&page=&per= for a server-paged table. `sort` must be one of
 * `allowedSorts` (column keys), so a URL can never order by an arbitrary column.
 */
export function parseTableParams(
  sp: { sort?: string; dir?: string; page?: string; per?: string },
  allowedSorts: readonly string[],
  opts: { defaultPer?: number; maxPer?: number } = {},
): ServerTableParams {
  const defaultPer = opts.defaultPer ?? 50;
  const maxPer = opts.maxPer ?? 200;
  const sort =
    sp.sort && allowedSorts.includes(sp.sort)
      ? { key: sp.sort, dir: (sp.dir === "desc" ? "desc" : "asc") as SortDir }
      : null;
  const pageNum = Number.parseInt(sp.page ?? "", 10);
  const perNum = Number.parseInt(sp.per ?? "", 10);
  return {
    sort,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
    per: Number.isFinite(perNum) && perNum > 0 ? Math.min(perNum, maxPer) : defaultPer,
  };
}
