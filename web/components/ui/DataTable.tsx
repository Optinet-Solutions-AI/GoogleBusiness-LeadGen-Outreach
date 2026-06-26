"use client";

/**
 * DataTable.tsx — reusable interactive table.
 *
 * - One scroll container (vertical + horizontal); header is sticky top-0 inside
 *   it, so it stays visible while the body scrolls (and never detaches/overlaps).
 * - Columns drag-to-reorder like a spreadsheet; order persists per browser via
 *   localStorage keyed by `storageKey`.
 * - Optional leading checkbox column for row selection (fixed, not draggable).
 *
 * Each table defines its own columns (with render fns) in a client wrapper and
 * passes them here; this owns only the mechanics.
 */

import { useEffect, useState } from "react";
import { GripVertical } from "lucide-react";

export interface DataColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Tailwind width/min-width class applied to header + cells. */
  width?: string;
  render: (row: T) => React.ReactNode;
}

export interface SelectionProps {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
}

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
}) {
  const [order, setOrder] = useState<string[]>(columns.map((c) => c.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setOrder(reconcile(JSON.parse(raw) as string[], columns));
      else setOrder(columns.map((c) => c.key));
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

  return (
    <div className={`bg-surface border border-rule rounded-lg overflow-auto ${maxHeight}`}>
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
            {cols.map((c) => (
              <th
                key={c.key}
                draggable
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
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-4 py-12 text-center text-[13px] text-ink-muted">
                {empty ?? "Nothing to show."}
              </td>
            </tr>
          )}
          {rows.map((row) => {
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
  );
}
