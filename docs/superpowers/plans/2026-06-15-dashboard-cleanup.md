# Dashboard Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stacked rows of filter pills with one quiet dropdown `FilterBar` across the dashboard, and add Week/Month/Year period navigation to the Status page — no palette or schema change.

**Architecture:** Two pure, unit-tested helpers (`buildFilterUrl`, `resolvePeriod`) back a set of small `components/ui/` primitives (`FilterSelect`, `SearchInput`, `FilterBar`, `SegmentedControl`, `PeriodStepper`). Pages stay server components that read `searchParams`; only `FilterSelect`/`SearchInput` are `"use client"` (they call `router.push`). All filter state lives in the URL.

**Tech Stack:** Next.js 14 App Router, React server components, Tailwind (existing tokens), `next/navigation`, Supabase JS, vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-15-dashboard-cleanup-design.md`

---

## File Structure

**Create:**
- `web/lib/url-params.ts` — `buildFilterUrl()` pure sibling-preserving URL builder
- `web/lib/url-params.test.ts` — vitest
- `web/lib/period.ts` — `resolvePeriod()` + `parsePeriod()` + `parseOffset()` (pure)
- `web/lib/period.test.ts` — vitest
- `web/components/ui/FilterSelect.tsx` — client labeled `<select>`
- `web/components/ui/SearchInput.tsx` — client debounced search
- `web/components/ui/FilterBar.tsx` — server layout row
- `web/components/ui/SegmentedControl.tsx` — server `<Link>` toggle group
- `web/components/ui/PeriodStepper.tsx` — server `← label →` nav

**Modify:**
- `web/app/(dashboard)/leads/page.tsx` — pills → FilterBar + `q` search (reference build)
- `web/app/(dashboard)/batches/page.tsx` — status pills → FilterSelect
- `web/app/(dashboard)/status/page.tsx` — period nav + `[start,end)` getNumbers

All commands run from `web/` unless noted.

---

## Task 1: `buildFilterUrl` URL helper

**Files:**
- Create: `web/lib/url-params.ts`
- Test: `web/lib/url-params.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/url-params.test.ts
import { describe, it, expect } from "vitest";
import { buildFilterUrl } from "./url-params";

describe("buildFilterUrl", () => {
  it("returns the base path when no params are active", () => {
    expect(buildFilterUrl("/leads", {}, {})).toBe("/leads");
  });

  it("preserves sibling params when patching one", () => {
    expect(
      buildFilterUrl("/leads", { stage: "replied", verify: "valid" }, { email: "has" }),
    ).toBe("/leads?stage=replied&verify=valid&email=has");
  });

  it("drops a key when the patch value is undefined or empty", () => {
    expect(
      buildFilterUrl("/leads", { stage: "replied", email: "has" }, { email: undefined }),
    ).toBe("/leads?stage=replied");
    expect(
      buildFilterUrl("/leads", { stage: "replied", email: "has" }, { email: "" }),
    ).toBe("/leads?stage=replied");
  });

  it("lets the patch override an existing value", () => {
    expect(buildFilterUrl("/leads", { stage: "replied" }, { stage: "dead" })).toBe(
      "/leads?stage=dead",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/url-params.test.ts`
Expected: FAIL — `Failed to resolve import "./url-params"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/lib/url-params.ts
/**
 * url-params.ts — build a dashboard URL that flips one or more query params
 * while preserving the others. Pure + framework-free so it unit-tests cleanly
 * and is safe to import from client components.
 *
 * Inputs:  basePath ("/leads"), the currently-active params, and a patch.
 * Outputs: "/leads?stage=replied&verify=valid" (empty/undefined values dropped).
 * Used by: components/ui/FilterSelect + SearchInput, and the list pages.
 */
export function buildFilterUrl(
  basePath: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const merged: Record<string, string | undefined> = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/url-params.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/url-params.ts web/lib/url-params.test.ts
git commit -m "feat(web): add buildFilterUrl sibling-preserving url helper"
```

---

## Task 2: `resolvePeriod` period helper

**Files:**
- Create: `web/lib/period.ts`
- Test: `web/lib/period.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/period.test.ts
import { describe, it, expect } from "vitest";
import { resolvePeriod, parsePeriod, parseOffset } from "./period";

// Wed 2026-06-17 → ISO week starts Mon 2026-06-15 (= 2026-W25); month June; year 2026.
const NOW = new Date("2026-06-17T12:00:00Z");

describe("parsePeriod", () => {
  it("defaults unknown/missing to week", () => {
    expect(parsePeriod(undefined)).toBe("week");
    expect(parsePeriod("junk")).toBe("week");
  });
  it("accepts month and year", () => {
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("year")).toBe("year");
  });
});

describe("parseOffset", () => {
  it("defaults to 0 and caps the future at 0", () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset("x")).toBe(0);
    expect(parseOffset("3")).toBe(0); // future is always empty
  });
  it("keeps negative offsets", () => {
    expect(parseOffset("-2")).toBe(-2);
  });
});

describe("resolvePeriod", () => {
  it("resolves the current week", () => {
    const r = resolvePeriod("week", 0, NOW);
    expect(r.start).toBe("2026-06-15T00:00:00.000Z");
    expect(r.end).toBe("2026-06-22T00:00:00.000Z");
    expect(r.label).toBe("Week 2026-W25");
    expect(r.isCurrent).toBe(true);
  });
  it("resolves the previous week", () => {
    const r = resolvePeriod("week", -1, NOW);
    expect(r.start).toBe("2026-06-08T00:00:00.000Z");
    expect(r.end).toBe("2026-06-15T00:00:00.000Z");
    expect(r.label).toBe("Week 2026-W24");
    expect(r.isCurrent).toBe(false);
  });
  it("resolves the current and previous month", () => {
    const cur = resolvePeriod("month", 0, NOW);
    expect(cur.start).toBe("2026-06-01T00:00:00.000Z");
    expect(cur.end).toBe("2026-07-01T00:00:00.000Z");
    expect(cur.label).toBe("June 2026");
    const prev = resolvePeriod("month", -1, NOW);
    expect(prev.start).toBe("2026-05-01T00:00:00.000Z");
    expect(prev.label).toBe("May 2026");
  });
  it("resolves the current year", () => {
    const r = resolvePeriod("year", 0, NOW);
    expect(r.start).toBe("2026-01-01T00:00:00.000Z");
    expect(r.end).toBe("2027-01-01T00:00:00.000Z");
    expect(r.label).toBe("2026");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/period.test.ts`
Expected: FAIL — `Failed to resolve import "./period"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/lib/period.ts
/**
 * period.ts — resolve a calendar period (week/month/year) + offset into a
 * concrete [start, end) UTC window and a human label. Pure → unit-testable.
 *
 * Inputs:  a PeriodKind, an integer offset (0 = current, -1 = previous), `now`.
 * Outputs: ResolvedPeriod { kind, offset, start, end, label, isCurrent }.
 * Used by: app/(dashboard)/status/page.tsx
 */
export type PeriodKind = "week" | "month" | "year";

export interface ResolvedPeriod {
  kind: PeriodKind;
  offset: number;   // 0 = current, negative = past
  start: string;    // ISO, inclusive
  end: string;      // ISO, exclusive
  label: string;
  isCurrent: boolean;
}

export function parsePeriod(v: string | undefined): PeriodKind {
  return v === "month" || v === "year" ? v : "week";
}

/** Clamp to a non-positive integer — future periods are always empty. */
export function parseOffset(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i > 0 ? 0 : i;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** ISO-8601 week label for the week containing `monday` (its Monday 00:00 UTC). */
function isoWeekLabel(monday: Date): string {
  const d = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function resolvePeriod(kind: PeriodKind, offset: number, now: Date): ResolvedPeriod {
  const off = offset > 0 ? 0 : Math.trunc(offset);
  let start: Date;
  let end: Date;
  let label: string;

  if (kind === "week") {
    const day = now.getUTCDay() || 7; // Mon=1..Sun=7
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
    start = new Date(monday);
    start.setUTCDate(start.getUTCDate() + off * 7);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    label = `Week ${isoWeekLabel(start)}`;
  } else if (kind === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + off, 1));
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear() + off, 0, 1));
    end = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
    label = `${start.getUTCFullYear()}`;
  }

  return { kind, offset: off, start: start.toISOString(), end: end.toISOString(), label, isCurrent: off === 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/period.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add web/lib/period.ts web/lib/period.test.ts
git commit -m "feat(web): add resolvePeriod week/month/year helper"
```

---

## Task 3: `FilterSelect` component

**Files:**
- Create: `web/components/ui/FilterSelect.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/ui/FilterSelect.tsx
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
        className="appearance-none bg-transparent font-semibold text-ink focus:outline-none cursor-pointer"
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
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add web/components/ui/FilterSelect.tsx
git commit -m "feat(web): add FilterSelect dropdown filter primitive"
```

---

## Task 4: `FilterBar` + `SearchInput` components

**Files:**
- Create: `web/components/ui/FilterBar.tsx`
- Create: `web/components/ui/SearchInput.tsx`

- [ ] **Step 1: Write `FilterBar`**

```tsx
// web/components/ui/FilterBar.tsx
/**
 * ui/FilterBar.tsx — one quiet, wrapping row of filter controls for list pages.
 * Replaces stacked rows of pills. Layout-only (server-compatible).
 *
 * Inputs:  children (FilterSelect / SearchInput), optional className.
 * Outputs: a flex-wrap row with consistent bottom margin.
 * Used by: dashboard list pages.
 */
import * as React from "react";
import { cx } from "@/lib/cx";

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap items-center gap-2 mb-6", className)}>{children}</div>;
}
```

- [ ] **Step 2: Write `SearchInput`**

```tsx
// web/components/ui/SearchInput.tsx
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
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/components/ui/FilterBar.tsx web/components/ui/SearchInput.tsx
git commit -m "feat(web): add FilterBar + debounced SearchInput primitives"
```

---

## Task 5: Convert Leads page to FilterBar + search (reference build)

**Files:**
- Modify: `web/app/(dashboard)/leads/page.tsx`

- [ ] **Step 1: Replace the pill arrays with option arrays**

Replace the `FILTER_PILLS` block (`web/app/(dashboard)/leads/page.tsx:28-38`) AND the `VERIFY_PILLS` / `EMAIL_PILLS` blocks (lines 93-104) with these three option arrays near the top of the file:

```tsx
const STAGE_OPTIONS = [
  { value: "", label: "All stages" },
  { value: "needs_email", label: "Needs email" },
  { value: "outreached", label: "Outreached" },
  { value: "replied", label: "Replied" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "improved", label: "Improved" },
  { value: "handed_over", label: "Handed over" },
  { value: "closed_won", label: "Closed won" },
  { value: "dead", label: "Dead" },
];

const EMAIL_OPTIONS = [
  { value: "", label: "All emails" },
  { value: "has", label: "Has email" },
  { value: "missing", label: "No email" },
];

const VERIFY_OPTIONS = [
  { value: "", label: "All verify" },
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
  { value: "invalid", label: "Invalid" },
];
```

- [ ] **Step 2: Update imports**

Replace the existing `import Link from "next/link";` line — `Link` is no longer used here — and the filter-helper import block. Ensure these imports exist at the top (keep `UserSearch`, `LeadsTable`, `PageHeader`, `EmptyState`, `VerifyLeadsButton`, `safeDb`):

```tsx
import { unstable_cache } from "next/cache";
import { UserSearch } from "lucide-react";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { SearchInput } from "@/components/ui/SearchInput";
import { VerifyLeadsButton } from "@/components/VerifyLeadsButton";
import { safeDb } from "@/lib/safe-db";
import {
  applyEmailFilter,
  parseEmailFilter,
  type EmailFilter,
  applyVerifyFilter,
  parseVerifyFilter,
  type VerifyFilter,
} from "@/lib/leads-filter";
```

- [ ] **Step 3: Add `q` to the query + signature**

Replace the `getLeads` signature + body (`web/app/(dashboard)/leads/page.tsx:46-69`) with:

```tsx
async function getLeads(
  stage: string | undefined,
  email: EmailFilter,
  verify: VerifyFilter,
  q: string | undefined,
): Promise<LeadRow[]> {
  return safeDb(
    async (db) => {
      let query = db
        .from("leads")
        .select(
          "id,business_name,address,country_code,category,email,stage,demo_url,custom_domain,updated_at," +
            "website_url,website_kind,business_status,is_service_area_only,is_franchise_flagged,language_code," +
            "category_off_niche,primary_offer,needs_improvement,website_score,verification_status",
        )
        .order("updated_at", { ascending: false })
        .limit(200);
      if (stage) query = query.eq("stage", stage);
      query = applyEmailFilter(query, email);
      query = applyVerifyFilter(query, verify);
      if (q && q.trim()) query = query.ilike("business_name", `%${q.trim()}%`);
      const { data } = await query;
      return ((data ?? []) as unknown as Array<LeadRow & { address: string | null }>).map((l) => ({
        ...l,
        city: cityFromAddress(l.address ?? null),
      }));
    },
    [] as LeadRow[],
  );
}
```

- [ ] **Step 4: Thread `q` through searchParams + the cached call**

Replace the `PageProps` interface (lines ~106-108) and the top of `LeadsPage` (lines ~110-117) with:

```tsx
interface PageProps {
  searchParams: { stage?: string; email?: string; verify?: string; q?: string };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const activeEmail = parseEmailFilter(searchParams.email);
  const activeVerify = parseVerifyFilter(searchParams.verify);
  const q = searchParams.q?.trim() || undefined;
  const [leads, coverage] = await Promise.all([
    cachedGetLeads(activeStage, activeEmail, activeVerify, q),
    cachedCoverage(),
  ]);
  const pct = coverage.total > 0 ? Math.round((coverage.withEmail / coverage.total) * 100) : 0;

  const current: Record<string, string | undefined> = {
    stage: activeStage,
    email: activeEmail,
    verify: activeVerify,
    q,
  };
```

Then DELETE the now-unused `urlWith` helper (the `const urlWith = ...` block, lines ~120-131).

- [ ] **Step 5: Replace the three pill rows with one FilterBar**

Replace the three `<div className="flex items-center gap-1.5 ...">` filter blocks (`web/app/(dashboard)/leads/page.tsx:152-212`) with:

```tsx
      <FilterBar>
        <FilterSelect label="Stage" param="stage" value={activeStage ?? ""} options={STAGE_OPTIONS} basePath="/leads" current={current} />
        <FilterSelect label="Email" param="email" value={activeEmail ?? ""} options={EMAIL_OPTIONS} basePath="/leads" current={current} />
        <FilterSelect label="Verify" param="verify" value={activeVerify ?? ""} options={VERIFY_OPTIONS} basePath="/leads" current={current} />
        <SearchInput value={q ?? ""} basePath="/leads" current={current} placeholder="Search business…" />
      </FilterBar>
```

- [ ] **Step 6: Refresh the empty-state copy for search**

In the `EmptyState` block (lines ~214-229), replace its `title` + `description` props with:

```tsx
          title={
            q
              ? `No leads matching “${q}”`
              : activeEmail === "has"
                ? "No leads with an email match"
                : activeStage
                  ? `No leads at stage "${activeStage}"`
                  : "No leads yet"
          }
          description={
            activeStage || activeEmail || activeVerify || q
              ? "Nothing matches these filters right now."
              : "Run a batch from the Batches page to start pulling in leads."
          }
```

- [ ] **Step 7: Update the cached wrapper signature**

The `cachedGetLeads` definition (line ~90) needs no code change — `unstable_cache` keys by the args it's called with, and Step 4 now passes `q`. Confirm the line still reads:

```tsx
const cachedGetLeads = unstable_cache(getLeads, ["leads-list"], { revalidate: 20 });
```

- [ ] **Step 8: Type-check + build**

Run: `npm run typecheck && npm run build`
Expected: PASS; `/leads` compiles. No "Link is defined but never used" or "urlWith unused" errors (Steps 2 + 4 removed them).

- [ ] **Step 9: Manual check**

Run: `npm run dev`, open `http://localhost:3000/leads`. Confirm: one row of three dropdowns + a search box; selecting a stage navigates and preserves the others; typing in search filters by business name after ~300ms; the row wraps on a narrow window.

- [ ] **Step 10: Commit**

```bash
git add web/app/(dashboard)/leads/page.tsx
git commit -m "feat(web): replace leads pill filters with dropdown bar + search"
```

---

## Task 6: Convert Batches status filter

**Files:**
- Modify: `web/app/(dashboard)/batches/page.tsx`

- [ ] **Step 1: Add imports**

Ensure the top of the file imports the primitives (add the three lines; keep existing imports):

```tsx
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterSelect";
```

- [ ] **Step 2: Replace the `FilterPills` component body**

Replace the entire `FilterPills` function (`web/app/(dashboard)/batches/page.tsx:282-310`) with this — it keeps the same name + `active` prop so the call site is unchanged:

```tsx
const BATCH_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

function FilterPills({ active }: { active: StatusFilter }) {
  const value = active === "all" ? "" : active;
  const current: Record<string, string | undefined> = {
    status: active === "all" ? undefined : active,
  };
  return (
    <FilterBar>
      <FilterSelect
        label="Status"
        param="status"
        value={value}
        options={BATCH_STATUS_OPTIONS}
        basePath="/batches"
        current={current}
      />
    </FilterBar>
  );
}
```

- [ ] **Step 3: Drop the now-unused `Link` import if orphaned**

Search the file for other `<Link` usages. If `FilterPills` was the only consumer of `next/link`, remove the `import Link from "next/link";` line. Otherwise leave it.

Run: `npx vitest run` is not needed here. Instead grep:
Run: `grep -n "Link" web/app/(dashboard)/batches/page.tsx`
Expected: if no `<Link` JSX remains, remove the import.

- [ ] **Step 4: Type-check + build**

Run: `npm run typecheck && npm run build`
Expected: PASS; `/batches` compiles.

- [ ] **Step 5: Manual check**

Open `http://localhost:3000/batches`. Confirm a single "Status" dropdown replaces the pill row; selecting a status filters and sets `?status=`; "All" returns to `/batches`.

- [ ] **Step 6: Commit**

```bash
git add web/app/(dashboard)/batches/page.tsx
git commit -m "feat(web): replace batches status pills with dropdown filter"
```

---

## Task 7: `SegmentedControl` + `PeriodStepper` components

**Files:**
- Create: `web/components/ui/SegmentedControl.tsx`
- Create: `web/components/ui/PeriodStepper.tsx`

- [ ] **Step 1: Write `SegmentedControl`**

```tsx
// web/components/ui/SegmentedControl.tsx
/**
 * ui/SegmentedControl.tsx — a small grouped toggle of <Link>s (zero client JS).
 * Each option is a URL; the active one is filled. Used for the Status period
 * switch (Week / Month / Year).
 *
 * Inputs:  options ({ value, label, href }), active value.
 * Outputs: a bordered inline segmented control.
 * Used by: app/(dashboard)/status/page.tsx
 */
import Link from "next/link";
import { cx } from "@/lib/cx";

export function SegmentedControl({
  options,
  active,
}: {
  options: { value: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-rule bg-surface p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          className={cx(
            "px-3 py-1 rounded text-[12px] font-semibold transition-colors",
            o.value === active ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `PeriodStepper`**

```tsx
// web/components/ui/PeriodStepper.tsx
/**
 * ui/PeriodStepper.tsx — ← <label> → navigation for the Status period window,
 * plus a reset link when off the current period. Zero client JS (<Link>s).
 * A null nextHref renders a disabled (non-link) forward arrow — the future is
 * always empty so you can't step past the current period.
 *
 * Inputs:  label, prevHref, nextHref (null = disabled), resetHref + resetLabel.
 * Outputs: an inline stepper control.
 * Used by: app/(dashboard)/status/page.tsx
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const ARROW =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rule text-ink-muted hover:text-ink hover:border-rule-strong transition-colors";
const ARROW_OFF =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rule text-ink-subtle/40 cursor-not-allowed";

export function PeriodStepper({
  label,
  prevHref,
  nextHref,
  resetHref,
  resetLabel,
}: {
  label: string;
  prevHref: string;
  nextHref: string | null;
  resetHref?: string | null;
  resetLabel?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Link href={prevHref} aria-label="Previous period" className={ARROW}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Link>
      <span className="mono-num text-[12px] text-ink min-w-[110px] text-center">{label}</span>
      {nextHref ? (
        <Link href={nextHref} aria-label="Next period" className={ARROW}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span aria-disabled className={ARROW_OFF}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </span>
      )}
      {resetHref && resetLabel && (
        <Link href={resetHref} className="text-[12px] text-action hover:underline ml-1">
          {resetLabel}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/components/ui/SegmentedControl.tsx web/components/ui/PeriodStepper.tsx
git commit -m "feat(web): add SegmentedControl + PeriodStepper primitives"
```

---

## Task 8: Status page period navigation

**Files:**
- Modify: `web/app/(dashboard)/status/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `web/app/(dashboard)/status/page.tsx` with:

```tsx
/**
 * (dashboard)/status/page.tsx — Weekly / monthly / yearly status.
 *
 * Inputs:  searchParams { period?, offset? } + Supabase rows (batches, leads,
 *          outreach_events) scoped to the resolved [start, end) window.
 * Outputs: top-line numbers + a plain-English summary for the selected period,
 *          with Week/Month/Year + prev/next navigation. No markdown file, no
 *          Claude Code dependency.
 * Used by: route "/status"
 */

import Link from "next/link";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { StatCard } from "@/components/StatCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PeriodStepper } from "@/components/ui/PeriodStepper";
import { buildFilterUrl } from "@/lib/url-params";
import { parsePeriod, parseOffset, resolvePeriod, type PeriodKind } from "@/lib/period";

export const dynamic = "force-dynamic";

type PeriodNumbers = {
  batches: number;
  leads: number;
  sites: number;
  emails: number;
  sms: number;
  replies: number;
};

async function getNumbers(start: string, end: string): Promise<PeriodNumbers> {
  const zero: PeriodNumbers = { batches: 0, leads: 0, sites: 0, emails: 0, sms: 0, replies: 0 };

  return safeDb<PeriodNumbers>(async (db) => {
    // Scope every count to the [start, end) window (closed-open).
    const range = <T,>(qb: T): T => (qb as any).gte("created_at", start).lt("created_at", end);
    const [batches, leadsScraped, sitesDeployed, emails, sms, replies] = await Promise.all([
      range(db.from("batches").select("id", { count: "exact", head: true })),
      range(db.from("leads").select("id", { count: "exact", head: true })),
      range(db.from("leads").select("id", { count: "exact", head: true })).not("demo_url", "is", null),
      range(db.from("outreach_events").select("id", { count: "exact", head: true })).eq("kind", "email_sent"),
      range(db.from("outreach_events").select("id", { count: "exact", head: true })).eq("kind", "sms_sent"),
      range(db.from("outreach_events").select("id", { count: "exact", head: true })).eq("kind", "replied"),
    ]);
    return {
      batches: batches.count ?? 0,
      leads: leadsScraped.count ?? 0,
      sites: sitesDeployed.count ?? 0,
      emails: emails.count ?? 0,
      sms: sms.count ?? 0,
      replies: replies.count ?? 0,
    };
  }, zero);
}

/** Plain-English bullets describing what happened in the period. */
function buildSummary(n: PeriodNumbers): string[] {
  const plural = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);
  const lines: string[] = [];
  if (n.batches) lines.push(`${n.batches} ${plural(n.batches, "batch", "batches")} run`);
  if (n.leads) lines.push(`${n.leads} new ${plural(n.leads, "lead")} scraped`);
  if (n.sites) lines.push(`${n.sites} demo ${plural(n.sites, "site")} deployed`);
  const sent = n.emails + n.sms;
  if (sent) {
    const parts: string[] = [];
    if (n.emails) parts.push(`${n.emails} email`);
    if (n.sms) parts.push(`${n.sms} SMS`);
    lines.push(`${sent} outreach ${plural(sent, "message")} sent (${parts.join(", ")})`);
  }
  if (n.replies) lines.push(`${n.replies} ${plural(n.replies, "reply", "replies")} received`);
  return lines;
}

const PERIOD_WORD: Record<PeriodKind, string> = { week: "week", month: "month", year: "year" };

export default async function StatusPage({
  searchParams,
}: {
  searchParams: { period?: string; offset?: string };
}) {
  const period = parsePeriod(searchParams.period);
  const offset = parseOffset(searchParams.offset);
  const resolved = resolvePeriod(period, offset, new Date());

  const configured = isDbConfigured();
  const numbers = await getNumbers(resolved.start, resolved.end);
  const summary = buildSummary(numbers);

  // Switching period always resets to the current window (offset 0).
  const segHref = (p: PeriodKind) =>
    buildFilterUrl("/status", {}, { period: p === "week" ? undefined : p });
  const segOptions = [
    { value: "week", label: "Week", href: segHref("week") },
    { value: "month", label: "Month", href: segHref("month") },
    { value: "year", label: "Year", href: segHref("year") },
  ];

  // Stepper hrefs keep the current period, vary the offset.
  const stepHref = (o: number) =>
    buildFilterUrl("/status", {}, {
      period: period === "week" ? undefined : period,
      offset: o === 0 ? undefined : String(o),
    });
  const prevHref = stepHref(offset - 1);
  const nextHref = offset >= 0 ? null : stepHref(offset + 1);
  const resetHref = resolved.isCurrent ? null : stepHref(0);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <p className="eyebrow mb-2">Status report</p>
        <h1 className="editorial-head text-ink text-[26px] sm:text-[32px] md:text-[36px] leading-none">
          Status
        </h1>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <SegmentedControl options={segOptions} active={period} />
          <PeriodStepper
            label={resolved.label}
            prevHref={prevHref}
            nextHref={nextHref}
            resetHref={resetHref}
            resetLabel={`This ${PERIOD_WORD[period]}`}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Batches" value={numbers.batches} hint={resolved.label} />
        <StatCard label="Leads scraped" value={numbers.leads} hint={resolved.label} />
        <StatCard label="Sites deployed" value={numbers.sites} emphasis hint={resolved.label} />
        <StatCard label="Replies" value={numbers.replies} hintTone="positive" hint={resolved.label} />
      </div>

      <section className="bg-surface border border-rule rounded-lg p-4 sm:p-6">
        <h2 className="eyebrow mb-4">
          {resolved.isCurrent ? `This ${PERIOD_WORD[period]} so far` : resolved.label}
        </h2>

        {!configured ? (
          <p className="text-[13px] text-ink-muted leading-relaxed">
            Connect Supabase (set{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">SUPABASE_URL</code>{" "}
            and{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">SUPABASE_SERVICE_KEY</code>
            ) and this summary fills in automatically from your pipeline activity.
          </p>
        ) : summary.length > 0 ? (
          <ul className="space-y-2">
            {summary.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[13px] sm:text-[14px] text-ink leading-relaxed">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-muted leading-relaxed">
            Nothing logged for this {PERIOD_WORD[period]}.{" "}
            {resolved.isCurrent ? (
              <>
                This summary updates on its own as the pipeline runs — kick one off from the{" "}
                <Link href="/batches" className="text-action hover:underline">
                  Batches
                </Link>{" "}
                page and the numbers above will start filling in.
              </>
            ) : (
              <>Try a different period, or step back to the current one.</>
            )}
          </p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + build**

Run: `npm run typecheck && npm run build`
Expected: PASS; `/status` compiles. (The old `fs`/`path`/`isoWeek`/`weekStart` code is gone — those helpers now live in `lib/period.ts`.)

- [ ] **Step 3: Manual check**

Open `http://localhost:3000/status`. Confirm: Week/Month/Year toggle + `← label →` stepper; clicking `←` shows the previous week and reveals a "This week" reset; the `→` is disabled on the current period; switching to Month/Year relabels the window and recomputes the cards; the bar wraps on narrow screens.

- [ ] **Step 4: Commit**

```bash
git add web/app/(dashboard)/status/page.tsx
git commit -m "feat(web): add week/month/year period nav to status page"
```

---

## Task 9: Calming sweep — Inbox + Campaigns consistency

**Files:**
- Modify: `web/app/(dashboard)/campaigns/page.tsx`
- Modify: `web/app/(dashboard)/inbox/page.tsx`

This is a light, visual-only pass — no logic changes. The goal: consistent
`PageHeader` usage and quieter in-table chips. Do NOT restructure data flow.

- [ ] **Step 1: Quiet the campaigns table chips**

In `web/app/(dashboard)/campaigns/page.tsx`, the channel/segment/status chips use
`rounded text-[11px] ... bg-surface-alt` (around lines 186-217). For each of the
three `<span className="inline-flex px-2 py-0.5 rounded text-[11px] ...">` chips,
change `text-[11px]` → `text-[10.5px]` and add `border border-rule` so they read
as quiet tags rather than filled blocks. Leave the `tone` classes untouched.

Example — the status chip becomes:

```tsx
<span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt capitalize ${STATUS_TONE[c.status] ?? "text-ink-muted"}`}>
  {c.status}
</span>
```

Apply the same `text-[10.5px] ... border border-rule` change to the channel and
segment chips.

- [ ] **Step 2: Confirm both pages use `PageHeader`**

Run: `grep -n "PageHeader\|<header" web/app/(dashboard)/campaigns/page.tsx web/app/(dashboard)/inbox/page.tsx`

For any page that hand-rolls a `<header>` with an `eyebrow` + `editorial-head`
H1 instead of `<PageHeader …>`, replace that header block with:

```tsx
<PageHeader eyebrow="<existing eyebrow text>" title="<existing title>" subtitle={<>…existing subtitle…</>} actions={<…existing actions…/>} />
```

(Keep the exact eyebrow/title/subtitle/actions content already on the page. Add
`import { PageHeader } from "@/components/ui/PageHeader";` if missing.) If a page
already uses `PageHeader`, leave it.

- [ ] **Step 3: Type-check + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual check**

Open `/campaigns` and `/inbox`. Confirm headers match the other pages and the
table chips read as quiet outlined tags.

- [ ] **Step 5: Commit**

```bash
git add web/app/(dashboard)/campaigns/page.tsx web/app/(dashboard)/inbox/page.tsx
git commit -m "style(web): quieter chips + consistent headers on campaigns/inbox"
```

---

## Task 10: Full verification + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: PASS, including the new `url-params` + `period` tests and the existing `kpis` tests.

- [ ] **Step 2: Type-check + production build**

Run: `npm run typecheck && npm run build`
Expected: PASS; all routes compile, `/leads`, `/batches`, `/status` listed.

- [ ] **Step 3: Manual regression across pages**

`npm run dev`, then click through `/leads`, `/batches`, `/status`, `/campaigns`,
`/inbox` at a narrow (~390px) and wide window. Confirm: no stacked pill rows
remain; filter dropdowns navigate and preserve siblings; back-button restores the
prior filter; nothing overflows horizontally.

- [ ] **Step 4: Push to deploy**

Per repo convention, pushing `main` auto-deploys to Vercel prod. Only push after
Steps 1-3 pass.

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (dropdown FilterBar across pages) → Tasks 3-6, 9.
- Goal 2 (Week/Month/Year period nav) → Tasks 2, 7, 8.
- Goal 3 (calming sweep) → Task 9.
- Goal 4 (server-rendered, URL-driven, responsive) → enforced in every task; verified Task 10 Step 3.
- Decisions: native `<select>` (Task 3), Leads search wired (Task 5), no schema/palette change (no migration tasks; tokens untouched).

**Type consistency:** `buildFilterUrl(basePath, current, patch)` signature is identical across FilterSelect, SearchInput, leads, batches, status. `resolvePeriod`/`parsePeriod`/`parseOffset` signatures match between `period.ts` and `status/page.tsx`. `PeriodNumbers` used consistently in `getNumbers` + `buildSummary`. `FilterSelect` props (`label/param/value/options/basePath/current`) match all call sites.

**Placeholders:** none — every code step contains complete code; the only "fill in existing content" step (Task 9 Step 2) explicitly says to preserve the page's current eyebrow/title/subtitle.
