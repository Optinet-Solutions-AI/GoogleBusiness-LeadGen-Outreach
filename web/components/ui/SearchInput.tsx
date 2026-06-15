"use client";

/**
 * ui/SearchInput.tsx — debounced text filter that sets ?<param>= on a list page
 * while preserving sibling params. Display-only; navigates ~300ms after typing.
 *
 * Inputs:  value (current term), param (default "q"), placeholder, basePath, current.
 * Outputs: router.push to the next URL after the debounce.
 * Used by: dashboard list pages via <FilterBar>.
 */
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { buildFilterUrl } from "@/lib/url-params";

export function SearchInput({
  value,
  param = "q",
  placeholder = "Search…",
  basePath,
  current,
}: {
  value: string;
  param?: string;
  placeholder?: string;
  basePath: string;
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [text, setText] = useState(value);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      router.push(buildFilterUrl(basePath, current, { [param]: text.trim() || undefined }));
    }, 300);
    return () => clearTimeout(id);
    // Only re-run when the typed text changes; current/basePath are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="relative inline-flex items-center">
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-ink-subtle" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="rounded-md border border-rule bg-surface pl-8 pr-3 py-1.5 text-[12px] text-ink placeholder:text-ink-subtle hover:border-rule-strong focus:border-action focus:outline-none min-w-[180px]"
      />
    </div>
  );
}
