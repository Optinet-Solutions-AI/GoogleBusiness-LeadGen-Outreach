# Dashboard cleanup — quiet filters + period nav (Refined-Editorial) — Design

- **Date:** 2026-06-15
- **Status:** Approved (pending spec review)
- **Author:** pipeline work session

## Problem

The dashboard reads as an "old, crowded" admin panel, not a professional product.
Two concrete causes, confirmed in the code:

1. **Filters are stacked rows of loud pills.** The Leads page renders **three
   rows** of pill `<Link>`s — 9 stage + 3 email + 4 verify = **16 buttons always
   visible** ([leads/page.tsx:152-212](../../../web/app/(dashboard)/leads/page.tsx#L152-L212)).
   Batches repeats the same pill style for its status filter
   ([batches/page.tsx:296-300](../../../web/app/(dashboard)/batches/page.tsx#L296)).
   The pills use uppercase mono tracking, which amplifies the visual noise.
2. **The Status page is locked to the current ISO week** with no way to see prior
   periods, and its "notes" historically depended on a Claude-Code-written
   markdown file (already replaced with a DB-generated summary on 2026-06-15).
   There is no month/year view.

The underlying token system is **not** the problem: globals.css is already a
clean, professional CRM palette (slate ink #0F172A, indigo accent #4F46E5, white
cards on soft-slate canvas, soft shadows, Sora display + JetBrains mono labels —
[globals.css:5-63](../../../web/app/globals.css#L5-L63)). So this is a **layout +
control-pattern** pass, **not** a re-skin.

## Goals

1. Replace stacked pill rows with **one quiet `FilterBar` row** of labeled
   dropdowns (`Stage: [ All ▾ ]`) + search, across the dashboard.
2. Add **Week / Month / Year period navigation** to the Status page (toggle +
   prev/next stepper), with all metrics recomputed for the selected window.
3. A light **calming sweep**: lighter hairline rules, consistent `PageHeader`
   usage, toned-down chips, consistent section spacing.
4. Keep everything **server-rendered, URL-param-driven, responsive**.

## Non-goals

- **No palette or typography change.** Existing tokens (slate/indigo/Sora/mono)
  stay. The serif headline shown in the brainstorm mockup was mockup-only; the
  real headline stays Sora (`.editorial-head`).
- **No DB schema change.** Status metrics derive from existing `created_at` /
  event timestamps; period windows are computed, not stored.
- **No custom popover menu** for v1 — native `<select>` (see Decisions). A
  branded popover can be a later upgrade.
- **No new pipeline/business logic.** Pure presentation + one cheap Leads search
  filter.

---

## Decisions (made during brainstorming)

- **Direction A — Refined Editorial.** Evolve the current look; calm it. No
  re-skin.
- **Filter UX = dropdown menus on one row** (not a single "Filters" panel, not
  refined pills).
- **Scope = sweep all dashboard pages** in one effort: leads, batches, status,
  inbox, campaigns.
- **Native `<select>`** over a custom popover: less code, free keyboard + mobile
  a11y, and globals.css already forces `color-scheme: light` on native selects
  ([globals.css:19-24](../../../web/app/globals.css#L19-L24)).
- **Wire Leads search now** (cheap `business_name ilike`) rather than ship a dead
  input.

---

## Part 1 — Shared primitives (`components/ui/`)

Each is small, single-purpose, and "dumb" (display + navigate; no business
logic), satisfying the client-component golden rule.

### `FilterSelect` (client)
A labeled native `<select>` rendered as `Stage: [ All ▾ ]`.

- **Props:** `label`, `name` (URL param key), `value` (active), `options:
  {value, label}[]`, and a `basePath` + the current `searchParams` so it can
  build the next URL.
- **Behavior:** on `change`, navigate (`router.push`) to the same path with this
  param set (or removed when "All"), **preserving all other active params**.
- **Styling:** trigger matches the mockup — surface bg, hairline `rule` border,
  rounded-md, `ink-muted` label + `ink` value, custom `▾` (native arrow hidden
  via `appearance-none`). Focus uses the global indigo ring.
- **A11y:** native select → keyboard + mobile pickers free.

### `FilterBar` (server-compatible wrapper)
A `flex flex-wrap items-center gap-2` row that lays out `FilterSelect`s + an
optional `SearchInput` + optional right-aligned `actions`. Replaces the stacked
pill `<div>`s. Wraps to multiple lines on narrow screens.

### `SearchInput` (client)
Debounced text input (~300ms) that sets `?q=` (preserving other params) and
navigates. Leading search icon. Clearing empties the param.

### `SegmentedControl` + `PeriodStepper` (`<Link>` groups, zero client JS)
For the Status page. `SegmentedControl` = `[ Week | Month | Year ]` (active
segment filled). `PeriodStepper` = `←  <label>  →` with a "This week/month/year"
reset shown only when off-current; **forward disabled at the current period**
(rendered as a non-link `<span>`, not an `<a>`). Each control is a group of plain
`<Link>`s since every option is just a URL — no client JS needed.

---

## Part 2 — Per-page changes

### Leads (`app/(dashboard)/leads/page.tsx`) — reference build
- Remove `FILTER_PILLS`, `EMAIL_PILLS`, `VERIFY_PILLS` markup ([lines 152-212](../../../web/app/(dashboard)/leads/page.tsx#L152-L212)).
- Render one `FilterBar`:
  `Stage` (All + 8 stages) · `Email` (All / Has / No) · `Verify` (All / Verified
  / Unverified / Invalid) · `Search`.
- The existing `urlWith()` helper logic moves into `FilterSelect` (build-URL
  preserving siblings). Keep `applyEmailFilter` / `applyVerifyFilter`.
- **Search:** add `q` to `searchParams`; in `getLeads`, when `q` is set, add
  `.ilike("business_name", \`%${q}%\`)`. Keep the 200-row cap + `unstable_cache`
  (cache key gains `q`).

### Batches (`app/(dashboard)/batches/page.tsx`)
- Replace the status pill row ([line 296](../../../web/app/(dashboard)/batches/page.tsx#L296)) with a
  single `Status` `FilterSelect` (All / queued / running / done / failed) in a
  `FilterBar`. Same `?status=` param + parsing.

### Status (`app/(dashboard)/status/page.tsx`)
- Add `searchParams: { period?: 'week'|'month'|'year'; offset?: string }`.
- New pure helper **`resolvePeriod(period, offset, now)` → `{ start, end, label,
  isCurrent }`** in `lib/period.ts` (pure, so it unit-tests in isolation):
  - week → ISO week (Mon 00:00 UTC → next Mon), label `Week 2026-W24`
  - month → 1st → next 1st, label `June 2026`
  - year → Jan 1 → next Jan 1, label `2026`
  - `offset` 0 = current, negative = past; future capped (no offset > 0).
- Generalize `getNumbers` to take `{ start, end }` and filter **`gte start` +
  `lt end`** (closed-open) on all metrics (currently open-ended `gte since`).
- Render `SegmentedControl` (period) + `PeriodStepper` above the cards. Switching
  period resets to offset 0. Summary heading: current → "This week so far"; past
  → the period label.

### Inbox + Campaigns (`app/(dashboard)/inbox/page.tsx`, `campaigns/page.tsx`)
- Lighter touch — they have few/no pill rows. Ensure consistent `PageHeader`;
  if a filter toggle exists, move it into a `FilterBar`. Apply the calming-sweep
  chip/spacing tweaks.

### Calming sweep (all list pages)
- Tone down the `rounded text-[11px] uppercase tracking-[0.14em]` chips used in
  tables (e.g. campaigns channel/segment/status) to a quieter weight.
- Consistent vertical rhythm (`PageHeader mb-7` → `FilterBar` → content), lighter
  `rule` dividers where rows feel heavy.

---

## Data flow

```
URL (?stage=&email=&verify=&q=  |  ?period=&offset=)
        │  (server component reads searchParams)
        ▼
page.tsx  ──► getLeads / getNumbers(range)  ──► Supabase (read-only)
        │
        ▼
PageHeader + FilterBar(FilterSelect…, SearchInput) + table / cards
        ▲
   onChange → router.push(next URL preserving siblings) → server re-render
```

No client-side data state; the URL is the single source of filter truth
(shareable, back-button correct). Server components keep doing the fetching.

## Error / edge handling

- **DB down / unconfigured:** existing `safeDb` fallbacks already return empty
  state; FilterBar still renders (filters just yield empty results).
- **Unknown param values:** `FilterSelect` falls back to "All"; `resolvePeriod`
  clamps unknown period → `week`, non-numeric offset → 0, offset > 0 → 0.
- **Empty search:** `q=""` removed from URL, no `ilike` applied.
- **No leads match:** existing `EmptyState` copy, extended to mention an active
  search term.

## Testing

- **Unit (pure):** `resolvePeriod` — week/month/year boundaries, offset math,
  future-cap, label formatting (Jest, mirrors `kpis.test.ts`). A `buildFilterUrl`
  helper (sibling-preserving) gets a unit test too.
- **Type-check + build:** `npm run typecheck` and `npm run build` clean.
- **Manual:** Leads filter combinations + search; Batches status; Status
  week/month/year + prev/next + current-cap; mobile width (filter row wraps).

## Sequencing (for the implementation plan)

1. Build primitives (`FilterSelect`, `FilterBar`, `SearchInput`) + convert
   **Leads** (reference). Visual checkpoint.
2. **Batches** filter + **Status** period nav (`SegmentedControl`,
   `PeriodStepper`, `resolvePeriod`, generalized `getNumbers`).
3. **Inbox / Campaigns** + the calming sweep.

Each step is independently shippable (build stays green); push to `main` deploys.
