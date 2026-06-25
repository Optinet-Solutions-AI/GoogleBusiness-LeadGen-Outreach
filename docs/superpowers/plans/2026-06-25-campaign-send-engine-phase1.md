# Campaign Send Engine (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the email sequence engine cap-aware multi-sender rotation with pinned follow-ups, plus randomized timezone-aware send-window scheduling, so campaigns can rotate across many mailboxes without looking botted and never switch a business's sender mid-thread.

**Architecture:** Two new pure modules — `sender-rotation.ts` (which mailbox to use) and `send-window.ts` (when the next send may go out) — are unit-tested in isolation, then wired into the existing `lib/pipeline/sequence-scheduler.ts`. Campaign config (mailbox pool + send window + country) lives on `call_campaigns`; the scheduler resolves a lead's most-recent active campaign at tick time. Phase 1 does NOT touch the wizard UI, dropdowns, translation maps, or inbox (those are Phases 2–3).

**Tech Stack:** TypeScript, Next.js, Supabase (Postgres), vitest. Timezone math via built-in `Intl.DateTimeFormat` (no date library in this repo).

## Global Constraints

- TypeScript strict; `npm run typecheck` must be clean before each commit (run from `web/`).
- All external calls stay inside `lib/services/*`; pure logic has no I/O.
- Every new `.ts` file starts with the repo's required docstring header (filename, one-line purpose, Inputs/Outputs/Used by).
- Tests use vitest; run from `web/` with `npx vitest run <path>`.
- Idempotent + deterministic: a re-run of the scheduler must pick the same mailbox and the same slot for the same lead/step (no `Math.random()` / `Date.now()` inside pure functions — seed from `lead.id`).
- DB migrations are SQL files under `db/migrations/`; latest is `036`. This adds `037`. Migrations are applied by the operator in Supabase, not by code.
- Follow-up sends MUST reuse the lead's pinned `seq_sender_email`; rotation only assigns a mailbox on the FIRST send (when `seq_sender_email` is null).

---

### Task 1: Migration — `call_campaigns.sender_emails`

**Files:**
- Create: `db/migrations/037_campaign_sender_emails.sql`

**Interfaces:**
- Produces: a `sender_emails text[]` column on `call_campaigns`, backfilled from the existing single `sender_email`.

- [ ] **Step 1: Write the migration**

```sql
-- 037_campaign_sender_emails.sql
-- Multi-sender campaigns: a campaign can rotate across several mailboxes.
-- sender_emails is the pool; the existing single sender_email is kept as a
-- back-compat fallback (treated as a one-element pool when sender_emails is null).
-- The scheduler assigns one pool member per lead at first send and pins it to
-- leads.seq_sender_email, so follow-ups never switch address.

alter table call_campaigns add column if not exists sender_emails text[];

update call_campaigns
set sender_emails = array[sender_email]
where sender_email is not null and sender_emails is null;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/037_campaign_sender_emails.sql
git commit -m "db: add call_campaigns.sender_emails for multi-sender campaigns"
```

> NOTE for the operator: apply `037` in the Supabase SQL editor before deploying Task 6/7.

---

### Task 2: Pure module — cap-aware sender rotation

**Files:**
- Create: `web/lib/campaigns/sender-rotation.ts`
- Test: `web/lib/campaigns/sender-rotation.test.ts`

**Interfaces:**
- Produces:
  - `interface SenderSlot { email: string; remaining: number }`
  - `pickSender(pool: SenderSlot[], leadId: string): string | null` — returns the chosen mailbox email, or `null` when every mailbox is at/over its cap (`remaining <= 0`) or the pool is empty. Deterministic per `leadId`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pickSender } from "./sender-rotation";

describe("pickSender", () => {
  const pool = [
    { email: "a@x.com", remaining: 5 },
    { email: "b@x.com", remaining: 5 },
    { email: "c@x.com", remaining: 5 },
  ];

  it("returns null for an empty pool", () => {
    expect(pickSender([], "lead1")).toBeNull();
  });

  it("returns null when every mailbox is capped", () => {
    expect(pickSender(pool.map((s) => ({ ...s, remaining: 0 })), "lead1")).toBeNull();
  });

  it("is deterministic for the same lead", () => {
    expect(pickSender(pool, "lead-abc")).toBe(pickSender(pool, "lead-abc"));
  });

  it("spreads different leads across mailboxes", () => {
    const picks = new Set(
      ["l1", "l2", "l3", "l4", "l5", "l6"].map((id) => pickSender(pool, id)),
    );
    // With 3 open mailboxes and 6 leads, we expect more than one distinct mailbox used.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("never picks a capped mailbox", () => {
    const mixed = [
      { email: "full@x.com", remaining: 0 },
      { email: "open@x.com", remaining: 3 },
    ];
    for (const id of ["a", "b", "c", "d"]) {
      expect(pickSender(mixed, id)).toBe("open@x.com");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/campaigns/sender-rotation.test.ts`
Expected: FAIL with "pickSender is not a function" / module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * sender-rotation.ts — Choose which mailbox sends a lead's FIRST email. Pure.
 *
 * Inputs:  a pool of mailboxes with remaining daily capacity + a lead id
 * Outputs: the chosen mailbox email (deterministic per lead), or null if none
 *          has capacity
 * Used by: lib/pipeline/sequence-scheduler.ts (first-send sender assignment)
 *
 * Deterministic so a scheduler re-run picks the same mailbox for the same lead.
 * Only mailboxes with remaining > 0 are eligible; the lead id is hashed to an
 * index into the eligible list so different leads spread across the pool while
 * each lead is stable. Once chosen, the caller pins it to seq_sender_email and
 * never re-rotates (follow-ups reuse the pinned mailbox).
 */

export interface SenderSlot {
  email: string;
  remaining: number;
}

/** FNV-1a — tiny, dependency-free, stable hash of the lead id. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function pickSender(pool: SenderSlot[], leadId: string): string | null {
  const eligible = pool.filter((s) => s.remaining > 0);
  if (eligible.length === 0) return null;
  // Stable order so the index mapping doesn't depend on input ordering.
  eligible.sort((a, b) => a.email.localeCompare(b.email));
  return eligible[hash(leadId) % eligible.length].email;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/campaigns/sender-rotation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/campaigns/sender-rotation.ts web/lib/campaigns/sender-rotation.test.ts
git commit -m "feat(campaigns): cap-aware deterministic sender rotation (pure)"
```

---

### Task 3: Pure module — randomized timezone-aware send window

**Files:**
- Create: `web/lib/campaigns/send-window.ts`
- Test: `web/lib/campaigns/send-window.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface SendWindow { tz: string; days: number[]; startHour: number; endHour: number }` (`days`: ISO 1=Mon..7=Sun)
  - `nextSlot(opts: { after: Date; window: SendWindow; seed: string; jitterMinMin?: number; jitterMaxMin?: number }): Date` — returns the next instant `>= after` that falls on an allowed day and within `[startHour, endHour)` in `window.tz`, plus a deterministic jitter (default 4–20 min) derived from `seed`. Scans forward day-by-day (max 14 days) and returns `after` only as a last-resort fallback.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { nextSlot, type SendWindow } from "./send-window";

// Helper: the wall-clock hour + ISO weekday of a Date in a given tz.
function partsIn(d: Date, tz: string): { hour: number; iso: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", hour12: false,
  });
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const parts = f.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const hr = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  return { hour: hr, iso: map[wd] };
}

const WINDOW: SendWindow = {
  tz: "America/New_York",
  days: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
};

describe("nextSlot", () => {
  it("lands inside the window in the target timezone", () => {
    // A Sunday 03:00 UTC base — must roll forward to a weekday 9-17 ET.
    const after = new Date("2026-06-21T03:00:00Z"); // Sunday
    const slot = nextSlot({ after, window: WINDOW, seed: "lead1" });
    const { hour, iso } = partsIn(slot, WINDOW.tz);
    expect(WINDOW.days).toContain(iso);
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(17);
    expect(slot.getTime()).toBeGreaterThanOrEqual(after.getTime());
  });

  it("is deterministic for the same seed", () => {
    const after = new Date("2026-06-22T08:00:00Z");
    const a = nextSlot({ after, window: WINDOW, seed: "x" });
    const b = nextSlot({ after, window: WINDOW, seed: "x" });
    expect(a.getTime()).toBe(b.getTime());
  });

  it("keeps a base time already inside the window (adds only jitter)", () => {
    // Monday 14:00 ET = 18:00 UTC.
    const after = new Date("2026-06-22T18:00:00Z");
    const slot = nextSlot({ after, window: WINDOW, seed: "y", jitterMinMin: 5, jitterMaxMin: 10 });
    const { hour, iso } = partsIn(slot, WINDOW.tz);
    expect(iso).toBe(1);
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(17);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/campaigns/send-window.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * send-window.ts — Next allowed send time inside a campaign's day/hour window,
 *                  in the prospect's timezone, with deterministic jitter. Pure.
 *
 * Inputs:  an "after" instant, a window (tz + ISO days + start/end hour), a seed
 * Outputs: the next Date >= after that falls on an allowed day inside the hour
 *          window in window.tz, plus a seeded 4-20 min jitter so sends don't
 *          fire on a fixed rhythm
 * Used by: lib/pipeline/sequence-scheduler.ts (scheduling seq_next_step_at)
 *
 * Timezone math uses Intl.DateTimeFormat (no date lib in this repo). Scans
 * forward up to 14 days for an allowed slot; returns `after` only as a last
 * resort. Deterministic: same seed + inputs -> same Date (safe to re-run).
 */

export interface SendWindow {
  tz: string;
  days: number[]; // ISO weekday 1=Mon..7=Sun
  startHour: number;
  endHour: number;
}

const ISO_BY_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Wall-clock hour, minute, and ISO weekday of an instant in a timezone. */
function zonedParts(d: Date, tz: string): { hour: number; minute: number; iso: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    iso: ISO_BY_WEEKDAY[get("weekday")],
  };
}

export function nextSlot(opts: {
  after: Date;
  window: SendWindow;
  seed: string;
  jitterMinMin?: number;
  jitterMaxMin?: number;
}): Date {
  const { after, window, seed } = opts;
  const jitMin = opts.jitterMinMin ?? 4;
  const jitMax = opts.jitterMaxMin ?? 20;
  const jitterMs = (jitMin + (hash(seed) % Math.max(1, jitMax - jitMin + 1))) * 60_000;

  // Step in 5-minute increments from `after`, up to 14 days, to find the first
  // instant that is on an allowed day and within [startHour, endHour) in tz.
  const STEP_MS = 5 * 60_000;
  const MAX_MS = 14 * 24 * 60 * 60_000;
  for (let t = 0; t <= MAX_MS; t += STEP_MS) {
    const cand = new Date(after.getTime() + t);
    const { hour, iso } = zonedParts(cand, window.tz);
    if (window.days.includes(iso) && hour >= window.startHour && hour < window.endHour) {
      const withJitter = new Date(cand.getTime() + jitterMs);
      // Re-verify the jittered time is still inside the window; if jitter pushed
      // it past endHour, drop the jitter (stay inside the window).
      const j = zonedParts(withJitter, window.tz);
      if (window.days.includes(j.iso) && j.hour >= window.startHour && j.hour < window.endHour) {
        return withJitter;
      }
      return cand;
    }
  }
  return after; // last resort — no valid slot found in 14 days
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/campaigns/send-window.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/campaigns/send-window.ts web/lib/campaigns/send-window.test.ts
git commit -m "feat(campaigns): timezone-aware jittered send-window scheduling (pure)"
```

---

### Task 4: Resolve a lead's campaign config in the scheduler

**Files:**
- Create: `web/lib/campaigns/lead-campaign-config.ts`
- Test: `web/lib/campaigns/lead-campaign-config.test.ts`
- Modify: none yet (wired in Task 5/6)

**Interfaces:**
- Consumes: `SendWindow` (Task 3).
- Produces:
  - `interface CampaignConfig { senderPool: string[]; window: SendWindow; countryCode: string | null }`
  - `buildCampaignConfig(input: { campaign: { sender_emails: string[] | null; sender_email: string | null; call_days: number[] | null; call_start_hour: number | null; call_end_hour: number | null; country_code: string | null } | null; leadCountryCode: string | null; tzFor: (cc: string | null) => string; allMailboxes: string[]; defaultWindow: { days: number[]; startHour: number; endHour: number } }): CampaignConfig` — pure mapping of a campaign row (or null) + fallbacks into the config the scheduler needs. When `campaign` is null, uses `allMailboxes` as the pool, the lead's country, and `defaultWindow`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildCampaignConfig } from "./lead-campaign-config";

const tzFor = (cc: string | null) => (cc === "au" ? "Australia/Sydney" : "UTC");
const DEFAULT = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 20 };

describe("buildCampaignConfig", () => {
  it("uses the campaign pool + window + country", () => {
    const cfg = buildCampaignConfig({
      campaign: { sender_emails: ["a@x.com", "b@x.com"], sender_email: "a@x.com", call_days: [1, 3], call_start_hour: 10, call_end_hour: 16, country_code: "au" },
      leadCountryCode: "us",
      tzFor, allMailboxes: ["z@x.com"], defaultWindow: DEFAULT,
    });
    expect(cfg.senderPool).toEqual(["a@x.com", "b@x.com"]);
    expect(cfg.window).toEqual({ tz: "Australia/Sydney", days: [1, 3], startHour: 10, endHour: 16 });
    expect(cfg.countryCode).toBe("au");
  });

  it("falls back to single sender_email when sender_emails is null", () => {
    const cfg = buildCampaignConfig({
      campaign: { sender_emails: null, sender_email: "solo@x.com", call_days: null, call_start_hour: null, call_end_hour: null, country_code: null },
      leadCountryCode: "au", tzFor, allMailboxes: ["z@x.com"], defaultWindow: DEFAULT,
    });
    expect(cfg.senderPool).toEqual(["solo@x.com"]);
    expect(cfg.window).toEqual({ tz: "Australia/Sydney", days: DEFAULT.days, startHour: 9, endHour: 20 });
  });

  it("no campaign -> all mailboxes, lead country, default window", () => {
    const cfg = buildCampaignConfig({
      campaign: null, leadCountryCode: "au", tzFor, allMailboxes: ["z@x.com", "y@x.com"], defaultWindow: DEFAULT,
    });
    expect(cfg.senderPool).toEqual(["z@x.com", "y@x.com"]);
    expect(cfg.countryCode).toBe("au");
    expect(cfg.window.tz).toBe("Australia/Sydney");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/campaigns/lead-campaign-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * lead-campaign-config.ts — Resolve the send config (mailbox pool, window, tz,
 *                           country) the scheduler should use for a lead. Pure.
 *
 * Inputs:  the lead's most-recent active campaign row (or null), the lead's
 *          country, a country->tz resolver, all active mailboxes, default window
 * Outputs: { senderPool, window, countryCode }
 * Used by: lib/pipeline/sequence-scheduler.ts
 *
 * A lead in a campaign uses that campaign's mailbox pool + window + country; a
 * lead in no campaign (enrolled directly from the lead page) falls back to all
 * active mailboxes, its own country, and the default window.
 */

import type { SendWindow } from "./send-window";

export interface CampaignConfig {
  senderPool: string[];
  window: SendWindow;
  countryCode: string | null;
}

interface CampaignRow {
  sender_emails: string[] | null;
  sender_email: string | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
  country_code: string | null;
}

export function buildCampaignConfig(input: {
  campaign: CampaignRow | null;
  leadCountryCode: string | null;
  tzFor: (cc: string | null) => string;
  allMailboxes: string[];
  defaultWindow: { days: number[]; startHour: number; endHour: number };
}): CampaignConfig {
  const { campaign, leadCountryCode, tzFor, allMailboxes, defaultWindow } = input;

  const senderPool =
    campaign?.sender_emails?.length
      ? campaign.sender_emails
      : campaign?.sender_email
        ? [campaign.sender_email]
        : allMailboxes;

  const countryCode = campaign?.country_code ?? leadCountryCode ?? null;

  const window: SendWindow = {
    tz: tzFor(countryCode),
    days: campaign?.call_days?.length ? campaign.call_days : defaultWindow.days,
    startHour: campaign?.call_start_hour ?? defaultWindow.startHour,
    endHour: campaign?.call_end_hour ?? defaultWindow.endHour,
  };

  return { senderPool, window, countryCode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/campaigns/lead-campaign-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/campaigns/lead-campaign-config.ts web/lib/campaigns/lead-campaign-config.test.ts
git commit -m "feat(campaigns): resolve per-lead send config from campaign or fallbacks (pure)"
```

---

### Task 5: Wire rotation + config into the scheduler's first-send sender assignment

**Files:**
- Modify: `web/lib/pipeline/sequence-scheduler.ts` (the tick loop's sender-resolution block around line 272–286, and the `SEQ_COLS` select to include `country_code` — already present per migration 014)
- Test: `web/lib/pipeline/sequence-scheduler-rotation.test.ts` (a focused integration test of the helper extracted below)

**Interfaces:**
- Consumes: `pickSender` (Task 2), `buildCampaignConfig` (Task 4), `campaignTimezone` (`lib/call-hours`), `getSenderAccount` + `effectiveDailyCap` (`lib/services/email-sender`).
- Produces: an exported helper `resolveSendSlot(lead, deps) : Promise<{ senderEmail: string; window: SendWindow } | { defer: true }>` that the tick uses. `deps` is injected so it's testable without DB.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveSendSlot } from "./sequence-scheduler";

describe("resolveSendSlot", () => {
  const baseLead = { id: "lead1", seq_sender_email: null, country_code: "us" } as any;

  it("pins a pool mailbox with capacity on first send", async () => {
    const out = await resolveSendSlot(baseLead, {
      loadCampaign: async () => ({ sender_emails: ["a@x.com", "b@x.com"], sender_email: null, call_days: [1,2,3,4,5], call_start_hour: 9, call_end_hour: 17, country_code: "us" }),
      remainingFor: async (email: string) => (email === "a@x.com" ? 0 : 5),
      allMailboxes: async () => ["a@x.com", "b@x.com"],
    });
    // a@ is capped, so it must pick b@.
    expect(out).toEqual(expect.objectContaining({ senderEmail: "b@x.com" }));
  });

  it("reuses the already-pinned sender (follow-up)", async () => {
    const out = await resolveSendSlot({ ...baseLead, seq_sender_email: "pinned@x.com" }, {
      loadCampaign: async () => null,
      remainingFor: async () => 5,
      allMailboxes: async () => ["other@x.com"],
    });
    expect(out).toEqual(expect.objectContaining({ senderEmail: "pinned@x.com" }));
  });

  it("defers when no mailbox has capacity", async () => {
    const out = await resolveSendSlot(baseLead, {
      loadCampaign: async () => null,
      remainingFor: async () => 0,
      allMailboxes: async () => ["a@x.com"],
    });
    expect(out).toEqual({ defer: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pipeline/sequence-scheduler-rotation.test.ts`
Expected: FAIL — `resolveSendSlot` not exported.

- [ ] **Step 3: Implement `resolveSendSlot` in `sequence-scheduler.ts`**

Add near the top-level helpers (after imports add):

```ts
import { pickSender } from "../campaigns/sender-rotation";
import { buildCampaignConfig } from "../campaigns/lead-campaign-config";
import { nextSlot, type SendWindow } from "../campaigns/send-window";
import { campaignTimezone } from "../call-hours";
```

Then add the exported helper:

```ts
/** Default send window for leads with no campaign (mirrors the wizard defaults). */
const DEFAULT_WINDOW = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 20 };

export interface ResolveSendDeps {
  /** Most-recent active campaign row for this lead, or null. */
  loadCampaign: (leadId: string) => Promise<{
    sender_emails: string[] | null; sender_email: string | null;
    call_days: number[] | null; call_start_hour: number | null;
    call_end_hour: number | null; country_code: string | null;
  } | null>;
  /** Remaining daily capacity for a mailbox (cap minus last-24h sends). */
  remainingFor: (email: string) => Promise<number>;
  /** All active mailbox emails (fallback pool). */
  allMailboxes: () => Promise<string[]>;
}

export async function resolveSendSlot(
  lead: { id: string; seq_sender_email: string | null; country_code: string | null },
  deps: ResolveSendDeps,
): Promise<{ senderEmail: string; window: SendWindow } | { defer: true }> {
  const campaign = await deps.loadCampaign(lead.id);
  const all = await deps.allMailboxes();
  const cfg = buildCampaignConfig({
    campaign,
    leadCountryCode: lead.country_code,
    tzFor: campaignTimezone,
    allMailboxes: all,
    defaultWindow: DEFAULT_WINDOW,
  });

  // Follow-up: a sender is already pinned — reuse it, never re-rotate.
  if (lead.seq_sender_email) {
    return { senderEmail: lead.seq_sender_email, window: cfg.window };
  }

  // First send: rotate over the pool, skipping mailboxes at/over their cap.
  const slots = await Promise.all(
    cfg.senderPool.map(async (email) => ({ email, remaining: await deps.remainingFor(email) })),
  );
  const chosen = pickSender(slots, lead.id);
  if (!chosen) return { defer: true };
  return { senderEmail: chosen, window: cfg.window };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pipeline/sequence-scheduler-rotation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/lib/pipeline/sequence-scheduler.ts web/lib/pipeline/sequence-scheduler-rotation.test.ts
git commit -m "feat(pipeline): resolveSendSlot — cap-aware rotation + pinned follow-ups"
```

---

### Task 6: Use `resolveSendSlot` + windowed scheduling in the tick

**Files:**
- Modify: `web/lib/pipeline/sequence-scheduler.ts` — the tick loop (sender resolution ~line 272–286; `seq_next_step_at` scheduling via `advanceState`/`plusHoursIso`) and `SEQ_COLS`/`SeqLeadRow` (add `country_code` if not already selected — it IS already in SEQ_COLS).

**Interfaces:**
- Consumes: `resolveSendSlot` (Task 5), `nextSlot` (Task 3), `effectiveDailyCap` + a 24h-count query.
- Produces: real DB-backed `loadCampaign` / `remainingFor` / `allMailboxes`; the tick pins `seq_sender_email` on first send and sets the next step time via `nextSlot`.

- [ ] **Step 1: Add the DB-backed deps + 24h remaining helper**

In `sequence-scheduler.ts`, add a helper that builds `ResolveSendDeps` from the DB:

```ts
async function sendDeps(db = getDb()): Promise<ResolveSendDeps> {
  return {
    loadCampaign: async (leadId) => {
      const { data } = await db
        .from("campaign_leads")
        .select("call_campaigns(sender_emails,sender_email,call_days,call_start_hour,call_end_hour,country_code,status,created_at)")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const c = (data as { call_campaigns?: any } | null)?.call_campaigns ?? null;
      return c && c.status !== "archived" ? c : null;
    },
    remainingFor: async (email) => {
      const acc = await getSenderAccount(email).catch(() => null);
      if (!acc) return 0;
      const cap = effectiveDailyCap(acc);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await db
        .from("outreach_events")
        .select("id", { count: "exact", head: true })
        .eq("kind", "email_sent")
        .eq("meta->>sender", email)
        .gte("created_at", since);
      return Math.max(0, cap - (count ?? 0));
    },
    allMailboxes: async () => {
      const { data } = await db.from("email_accounts").select("email").eq("status", "active");
      return (data ?? []).map((r: { email: string }) => r.email);
    },
  };
}
```

> NOTE: `effectiveDailyCap` is exported from `lib/services/email-sender`; import it. If `outreach_events.meta` does not store `sender`, fall back to counting all `email_sent` in 24h per account via the same query without the sender filter — verify the meta shape in `email-sender.ts` before finalizing this query and adjust the `.eq("meta->>sender", email)` filter to match the real key.

- [ ] **Step 2: Replace the inline sender-resolution block**

Find the existing block (around lines 272–286) that resolves `senderEmail` via `getSenderAccount` and replace it with:

```ts
    const slot = await resolveSendSlot(
      { id: lead.id, seq_sender_email: lead.seq_sender_email, country_code: lead.country_code },
      await sendDeps(db),
    );
    if ("defer" in slot) {
      // No mailbox under its cap right now — try again next window. Stay active.
      await db.from("leads").update({ seq_next_step_at: plusHoursIso(HOLD_HOURS) }).eq("id", lead.id);
      summary.held++;
      continue;
    }
    const senderEmail = slot.senderEmail;
    // Pin on first send so every follow-up reuses this mailbox.
    if (!lead.seq_sender_email) {
      await db.from("leads").update({ seq_sender_email: senderEmail }).eq("id", lead.id);
    }
```

- [ ] **Step 3: Use the window for the NEXT step time**

Where the tick advances state after a successful send (the `advanceState(targetStep, vmax)` update that sets `seq_next_step_at`), compute the next time with `nextSlot` instead of a bare `plusHoursIso`. Replace the `seq_next_step_at` value in that update with:

```ts
      seq_next_step_at: nextSlot({
        after: new Date(Date.now() + STEP_GAP_HOURS * 60 * 60 * 1000),
        window: slot.window,
        seed: `${lead.id}:${targetStep}`,
      }).toISOString(),
```

Add near the constants: `const STEP_GAP_HOURS = 4 * 24; // 4 days between ladder steps` (matches the approved 4-day cadence). For step 1 (first send) where `advanceState` schedules step 2, this snaps the follow-up into the window with jitter.

> NOTE: `Date.now()` is allowed here (runtime scheduler code, not a pure module). `nextSlot` itself stays pure (time passed in).

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npx vitest run` then `npm run typecheck`
Expected: all green; existing scheduler tests still pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/pipeline/sequence-scheduler.ts
git commit -m "feat(pipeline): rotate senders + schedule sends inside the campaign window"
```

---

### Task 7: Enroll campaign members into the sequence (unify the send path)

**Files:**
- Modify: `web/app/api/campaigns/route.ts` — after creating an email campaign + members, enroll the members into the sequence.
- Modify: `web/app/api/campaigns/route.ts` zod body — accept `sender_emails: string[]` (keep `sender_email` optional for back-compat).
- Test: `web/lib/campaigns/enroll-members.test.ts` (pure helper that decides which member ids are enrollable)

**Interfaces:**
- Consumes: `enrollLeadInSequence` (`lib/pipeline/sequence-scheduler`).
- Produces: on email-campaign create, each member with an email is enrolled (`seq_status='active'`), pulling its sender pool/window from the campaign at tick time (Task 6). The single-shot `stage-5-email` launch path is left intact but no longer the primary route (documented; not deleted in Phase 1).

- [ ] **Step 1: Write the failing test for the enrollable filter**

```ts
import { describe, it, expect } from "vitest";
import { enrollableMemberIds } from "./enroll-members";

describe("enrollableMemberIds", () => {
  it("keeps leads that have an email and aren't already active", () => {
    const ids = enrollableMemberIds([
      { id: "1", email: "a@x.com", seq_status: null },
      { id: "2", email: null, seq_status: null },
      { id: "3", email: "c@x.com", seq_status: "active" },
    ]);
    expect(ids).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/campaigns/enroll-members.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure filter**

```ts
/**
 * enroll-members.ts — Decide which campaign members to enroll in the sequence.
 *
 * Inputs:  member leads { id, email, seq_status }
 * Outputs: ids of leads that have an email and aren't already in an active ladder
 * Used by: app/api/campaigns/route.ts (email-campaign create)
 */
export function enrollableMemberIds(
  members: { id: string; email: string | null; seq_status: string | null }[],
): string[] {
  return members
    .filter((m) => !!m.email && m.seq_status !== "active")
    .map((m) => m.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/campaigns/enroll-members.test.ts`
Expected: PASS.

- [ ] **Step 5: Accept `sender_emails` + enroll on create**

In `app/api/campaigns/route.ts`: add `sender_emails: z.array(z.string()).optional()` to the body schema; persist it on the campaign insert (`sender_emails: b.channel === "email" ? (b.sender_emails ?? (b.sender_email ? [b.sender_email] : null)) : null`). After members are inserted, for email campaigns load the members' `id,email,seq_status`, compute `enrollableMemberIds`, and call `enrollLeadInSequence(id)` for each (sequentially or `Promise.all`). Wrap in try/catch and log; enrollment failure must not fail campaign creation.

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck` then `npx vitest run`
Expected: clean / green.

- [ ] **Step 7: Commit**

```bash
git add web/app/api/campaigns/route.ts web/lib/campaigns/enroll-members.ts web/lib/campaigns/enroll-members.test.ts
git commit -m "feat(campaigns): enroll email-campaign members into the sequence on create"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Multi-sender rotation → Tasks 2, 5, 6. ✓
- Pinned follow-ups → Task 5 (reuse `seq_sender_email`) + Task 6 (pin on first send). ✓
- Randomized timezone-aware window → Task 3 + Task 6. ✓
- Per-mailbox cap honored → Task 6 `remainingFor` + Task 2 skip-capped. ✓
- Unify campaign send onto the sequence → Task 7. ✓
- `sender_emails` data model → Task 1. ✓
- Country/category dropdowns, expanded tz/lang maps, country-driven translation, inbox grouping → **Phase 2 & 3, separate plans** (out of scope here, by design).

**Placeholder scan:** One explicit verification NOTE in Task 6 Step 1 (confirm the `outreach_events.meta` sender key before finalizing the count query) — this is a real "check the existing shape" instruction, not a placeholder; the fallback is specified.

**Type consistency:** `SendWindow` (Task 3) is consumed by Tasks 4–6 with the same shape; `pickSender(SenderSlot[], leadId)` (Task 2) used in Task 5; `resolveSendSlot` return type (`{senderEmail, window} | {defer:true}`) consumed in Task 6; `buildCampaignConfig` campaign row shape matches the `loadCampaign` select in Task 6.

## Phases 2 & 3 (separate plans, after Phase 1 ships)
- **Phase 2:** wizard multi-mailbox multi-select; country `<select>` + category `<select>`; expand `COUNTRY_TZ` + new `COUNTRY_LANG`; country-driven `resolveLanguageCode`.
- **Phase 3:** inbox grouped/sorted/filtered by campaign.
