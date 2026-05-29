"use client";

/**
 * Combobox.tsx — themed input+dropdown that replaces the native
 * <input list>/<datalist> pattern used elsewhere.
 *
 * Why this exists: the native HTML datalist
 *   (a) only surfaces after typing — clicking the field doesn't open it;
 *   (b) renders with the browser's default OS-style chrome, which clashes
 *       with the modal's action-color theme;
 *   (c) ignores the modal's font and rounded-corner tokens.
 * This Combobox opens on click/focus, can be browsed without typing,
 * filters as the user types, supports keyboard navigation, AND inherits
 * the same theme tokens (action, rule, surface-alt, ink-muted) as the
 * rest of the dashboard.
 *
 * Free-form typing is still allowed — selecting an option commits the
 * value, but typing anything and tabbing out also commits. The dropdown
 * just makes the curated suggestions visible & browseable.
 */

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useId,
  type RefObject,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { ChevronDown, Check } from "lucide-react";

export interface ComboboxOption<T = undefined> {
  /** Canonical value committed on selection (also matched against the input). */
  value: string;
  /** Display label inside the option row. Defaults to `value`. */
  label?: string;
  /** Optional group header. Adjacent options sharing the same group render under one header. */
  group?: string;
  /** Caller-supplied metadata used by `renderOption` (e.g. yield, quality dot). */
  meta?: T;
}

export interface ComboboxProps<T> {
  value: string;
  onChange: (next: string) => void;
  options: ComboboxOption<T>[];
  placeholder?: string;
  /** Optional custom row renderer. Receives the option + whether it's the active (highlighted) row. */
  renderOption?: (opt: ComboboxOption<T>, isActive: boolean) => ReactNode;
  /** Pass an existing ref to focus the input from a parent. */
  inputRef?: RefObject<HTMLInputElement>;
  /** Tailwind classes for the <input>; defaults to the modal's standard INPUT_CLS. */
  className?: string;
  /** Show ChevronDown affordance inside the input. Default true. */
  showChevron?: boolean;
}

export function Combobox<T>({
  value,
  onChange,
  options,
  placeholder,
  renderOption,
  inputRef: externalInputRef,
  className =
    "w-full h-9 px-3 pr-9 text-body-base border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white",
  showChevron = true,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIdx, setActiveIdx] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const listboxId = useId();

  // Sync external value → internal query when parent updates value
  // (e.g. "Suggest market" sets a city without going through this input).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Filter logic: when the input matches the committed value exactly,
  // show ALL options (the user just opened the dropdown to browse).
  // When the query has diverged from value, filter substring on value
  // + label + group so typing narrows the list.
  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || trimmed === value.trim().toLowerCase()) return options;
    return options.filter((o) => {
      const v = o.value.toLowerCase();
      const l = (o.label ?? "").toLowerCase();
      const g = (o.group ?? "").toLowerCase();
      return v.includes(trimmed) || l.includes(trimmed) || g.includes(trimmed);
    });
  }, [options, query, value]);

  // Group adjacent options sharing the same `group` field. Preserves
  // the order callers supplied so the dashboard's category sort sticks.
  const grouped = useMemo(() => {
    const out: Array<{ group: string; opts: ComboboxOption<T>[] }> = [];
    for (const o of filtered) {
      const g = o.group ?? "";
      const last = out[out.length - 1];
      if (last && last.group === g) {
        last.opts.push(o);
      } else {
        out.push({ group: g, opts: [o] });
      }
    }
    return out;
  }, [filtered]);

  // Click-outside closes the panel; clicking on the input itself doesn't.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Reset highlighted row when the filtered list shrinks past the cursor.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  function commit(next: string) {
    onChange(next);
    setQuery(next);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx].value);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Tab") {
      // Commit current query (free-form OK) and let focus move on.
      if (query !== value) onChange(query);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // The click-outside handler closes the panel; if focus leaves
          // via Tab or programmatically and the typed query differs
          // from the committed value, treat the typed query as the
          // free-form value the operator wants.
          if (query.trim() !== value.trim()) onChange(query);
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className={className}
      />
      {showChevron && (
        <ChevronDown
          className={[
            "absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-subtle pointer-events-none transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden
        />
      )}

      {open && filtered.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1.5 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-rule bg-white shadow-xl shadow-ink/10 ring-1 ring-ink/5"
        >
          {grouped.map((g, gi) => (
            <div key={`${g.group}-${gi}`}>
              {g.group && (
                <div className="px-3 py-1.5 bg-surface-alt text-[10px] font-bold uppercase tracking-[0.12em] text-ink-subtle border-b border-rule sticky top-0">
                  {g.group}
                </div>
              )}
              {g.opts.map((o) => {
                // filtered order = render order, so we can compute the
                // global active-index match via indexOf without
                // worrying about group offsets.
                const idx = filtered.indexOf(o);
                const isActive = idx === activeIdx;
                const isSelected = o.value.toLowerCase() === value.trim().toLowerCase();
                return (
                  <button
                    key={`${o.value}-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => e.preventDefault() /* don't blur the input */}
                    onClick={() => commit(o.value)}
                    className={[
                      "w-full text-left px-3 py-2 flex items-center gap-2 transition-colors border-b border-rule/30 last:border-b-0",
                      isActive ? "bg-action-soft" : "hover:bg-surface-alt",
                    ].join(" ")}
                  >
                    {renderOption ? (
                      renderOption(o, isActive)
                    ) : (
                      <span className="text-[13px] text-ink">{o.label ?? o.value}</span>
                    )}
                    {isSelected && (
                      <Check className="ml-auto h-4 w-4 text-action flex-none" strokeWidth={2.5} />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1.5 left-0 right-0 rounded-lg border border-rule bg-white shadow-xl shadow-ink/10 ring-1 ring-ink/5">
          <div className="px-3 py-3 text-[12px] text-ink-muted italic">
            No matches — press Enter to use &ldquo;{query}&rdquo; as-is.
          </div>
        </div>
      )}
    </div>
  );
}
