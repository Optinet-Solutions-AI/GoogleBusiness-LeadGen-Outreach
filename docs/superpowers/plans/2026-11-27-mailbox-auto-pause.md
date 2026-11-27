# Mailbox auto-pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 15 minutes the app pauses any sending mailbox whose hard bounces or spam complaints climb, shows why on
every page, and keeps it paused until the operator presses Resume.

**Architecture:** A pure rules file (window, attribution, verdict) + a runner that reads `email_messages` (sends) and
`outreach_events` (bounces / complaints) and pauses mailboxes, run as a new part of the automation tick. Pausing uses
the existing `email_accounts.status = 'paused'`; two existing gaps are closed so a pause is safe (pinned follow-ups
wait instead of being skipped; replies to a paused mailbox are still read).

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase, vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-mailbox-auto-pause-design.md`

## Global Constraints

- Window **7 days**, starting no earlier than the mailbox's last `resumed_at`.
- Bounces: pause when sends ≥ **20** AND hard bounces ≥ **5%** of sends AND hard bounces ≥ **2**. Soft bounces don't count.
- Complaints: pause at **2 or more** in the window, whatever the sends.
- A bounce / complaint belongs to the mailbox that sent that lead's **last email before it**; unmatched ones are ignored;
  each lead counts once per kind; windows go by event time.
- Paused by the app stays paused until Resume (no automatic resume). Any Resume restarts the window.
- Migration **077** (`email_accounts.paused_reason`, `paused_at`, `paused_by` `'auto'|'operator'`, `resumed_at`); code
  tolerates them missing.
- Free; no paid calls; Test mode unaffected. Required file headers; thin routes; dumb client components.
- Commands from `web/`: `npx vitest run <file>`, `npm run typecheck`, `npm run lint`. Commits end
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.

## Review Focus

1. A mailbox resumed an hour ago whose old bounces are still in the last 7 days: must NOT be paused again (Task 1).
2. A lead bounced twice (Ongage + inbox report the same bounce): counts once (Task 1).
3. A follow-up pinned to a paused mailbox: waits (held), never recorded as sent (Task 3).
4. Database without 077: the tick part reports "skipped", never throws, nothing paused (Task 2).
5. Two ticks racing on the same mailbox: the pause is a conditional update (`status = 'active'`), so the second does
   nothing and the reason isn't overwritten (Task 2).

---

### Task 1: Health rules (pure)

**Files:** Create `web/lib/email/mailbox-health.ts`; Test `web/lib/email/mailbox-health.test.ts`

**Interfaces — Produces:**
- `HEALTH = { windowDays: 7, minSends: 20, bounceRate: 0.05, minBounces: 2, maxComplaints: 2 } as const`
- `windowStart(now: Date, resumedAt: string | null): Date` — the later of now − 7 days and `resumedAt`
- `interface HealthSend { lead_id: string; from: string; at: string }` (from = mailbox address, any case)
- `interface HealthEvent { lead_id: string; kind: "bounce" | "complaint"; at: string }` (hard bounces only reach here)
- `interface MailboxTally { sent: number; bounces: number; complaints: number }`
- `tallyMailbox(email: string, since: Date, sends: HealthSend[], events: HealthEvent[]): MailboxTally` — sent = this
  mailbox's sends at/after `since`; an event at/after `since` counts when the lead's latest send before the event is
  from this mailbox; distinct leads per kind
- `healthVerdict(t: MailboxTally, days: number): { pause: false } | { pause: true; reason: string }` — reasons exactly:
  `"${n} spam complaint${n===1?"":"s"} in the last ${days} days"` (checked first) and
  `"${b} hard bounces out of ${s} emails in the last ${days} days (${pct}%)"` with `pct = Math.round(b / s * 100)`
- `windowDays(now: Date, since: Date): number` — whole days covered, `Math.max(1, Math.round((now − since) / 86_400_000))`

- [ ] **Step 1: Failing tests**

```ts
const NOW = new Date("2026-12-10T12:00:00Z");
const S = (lead_id: string, from: string, at: string): HealthSend => ({ lead_id, from, at });
const B = (lead_id: string, at: string, kind: "bounce" | "complaint" = "bounce"): HealthEvent => ({ lead_id, kind, at });

it("window: 7 days, or since the last Resume when that's later", () => {
  expect(windowStart(NOW, null).toISOString()).toBe("2026-12-03T12:00:00.000Z");
  expect(windowStart(NOW, "2026-12-09T00:00:00Z").toISOString()).toBe("2026-12-09T00:00:00.000Z");
  expect(windowStart(NOW, "2026-11-01T00:00:00Z").toISOString()).toBe("2026-12-03T12:00:00.000Z");
});
it("a bounce belongs to the mailbox that sent the lead's last email before it; once per lead", () => {
  const since = windowStart(NOW, null);
  const sends = [S("a", "Grace@x.com", "2026-12-04T00:00:00Z"), S("a", "ethan@y.com", "2026-12-05T00:00:00Z"), S("b", "grace@x.com", "2026-12-05T00:00:00Z")];
  const events = [B("a", "2026-12-06T00:00:00Z"), B("a", "2026-12-06T00:10:00Z"), B("b", "2026-12-06T00:00:00Z"), B("c", "2026-12-06T00:00:00Z")];
  expect(tallyMailbox("grace@x.com", since, sends, events)).toEqual({ sent: 2, bounces: 1, complaints: 0 });
  expect(tallyMailbox("ethan@y.com", since, sends, events)).toEqual({ sent: 1, bounces: 1, complaints: 0 });
});
it("after a Resume, older sends and bounces don't count", () => {
  const since = windowStart(NOW, "2026-12-08T00:00:00Z");
  const sends = [S("a", "g@x.com", "2026-12-04T00:00:00Z"), S("b", "g@x.com", "2026-12-09T00:00:00Z")];
  expect(tallyMailbox("g@x.com", since, sends, [B("a", "2026-12-05T00:00:00Z")])).toEqual({ sent: 1, bounces: 0, complaints: 0 });
});
it("a send before the window still owns a bounce inside it", () => {
  const since = windowStart(NOW, null);
  expect(tallyMailbox("g@x.com", since, [S("a", "g@x.com", "2026-12-01T00:00:00Z")], [B("a", "2026-12-04T00:00:00Z")])).toEqual({ sent: 0, bounces: 1, complaints: 0 });
});
it("verdict: bounces need 20 sends, 5% and 2 bounces; complaints need 2", () => {
  expect(healthVerdict({ sent: 19, bounces: 5, complaints: 0 }, 7)).toEqual({ pause: false });
  expect(healthVerdict({ sent: 40, bounces: 1, complaints: 0 }, 7)).toEqual({ pause: false });
  expect(healthVerdict({ sent: 60, bounces: 2, complaints: 0 }, 7)).toEqual({ pause: false }); // 3%
  expect(healthVerdict({ sent: 31, bounces: 4, complaints: 0 }, 7)).toEqual({ pause: true, reason: "4 hard bounces out of 31 emails in the last 7 days (13%)" });
  expect(healthVerdict({ sent: 3, bounces: 0, complaints: 2 }, 7)).toEqual({ pause: true, reason: "2 spam complaints in the last 7 days" });
  expect(healthVerdict({ sent: 3, bounces: 0, complaints: 1 }, 7)).toEqual({ pause: false });
});
it("windowDays", () => {
  expect(windowDays(NOW, windowStart(NOW, null))).toBe(7);
  expect(windowDays(NOW, new Date("2026-12-10T06:00:00Z"))).toBe(1);
});
```

- [ ] **Step 2: Run** `npx vitest run lib/email/mailbox-health.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `web/lib/email/mailbox-health.ts` (addresses compared lower-cased).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): mailbox health rules (window, attribution, verdict)`.

---

### Task 2: Migration 077, the check, the tick part, the workflow

**Files:**
- Create `db/migrations/077_mailbox_pause.sql`; Modify `db/schema.sql` (email_accounts columns)
- Create `web/lib/email/mailbox-health-run.ts`; Test `web/lib/email/mailbox-health-run.test.ts`
- Modify `web/lib/automation/tick.ts` — `await part("mailboxHealth", () => checkMailboxHealth(now));` as the FIRST part
- Create `workflows/watch_mailbox_health.md` (rule, where it shows, Resume, 077); Modify `workflows/run_automation.md`
  (one line: the tick's new first part)

```sql
-- 077_mailbox_pause.sql — mailbox auto-pause (27 Nov 2026): why and when a mailbox was paused, and when it was resumed.
alter table email_accounts add column if not exists paused_reason text;
alter table email_accounts add column if not exists paused_at timestamptz;
alter table email_accounts add column if not exists paused_by text check (paused_by in ('auto', 'operator'));
alter table email_accounts add column if not exists resumed_at timestamptz;
```

**Interfaces:**
- Consumes: Task 1.
- Produces: `checkMailboxHealth(now?: number, deps?: HealthDeps): Promise<{ checked: number; paused: { email: string; reason: string }[] } | { skipped: string }>`
  with `HealthDeps = { mailboxes(): Promise<{ id: string; email: string; resumed_at: string | null }[]>; sends(emails: string[], since: string): Promise<HealthSend[]>; events(since: string): Promise<HealthEvent[]>; pause(id: string, reason: string, at: string): Promise<boolean> }`.
  Real deps: mailboxes = `email_accounts` `status='active'` (select includes `resumed_at`; a select error naming
  `resumed_at` → `{ skipped: "Run database update 077 (mailbox auto-pause)." }`); sends = `email_messages`
  `direction='outbound'`, `status='sent'`, `created_at >= since − 14 days` (attribution look-back), `from_addr` in the
  mailboxes (lower-cased), paged by 1000; events = `outreach_events` kinds `email_bounced` with `meta->>bounceKind =
  'hard'` and `email_complaint`, `created_at >= since`, paged; pause = `update({ status: 'paused', paused_reason,
  paused_at, paused_by: 'auto' }).eq('id').eq('status','active')` returning whether a row changed. `since` passed to
  `events` = the earliest window start of the mailboxes. Logs each pause (`mailbox_health.paused`).

- [ ] **Step 1: Failing tests** (inject deps):

```ts
it("pauses a mailbox over the bounce limit, with the reason, and leaves a healthy one alone", async () => {
  // grace: 31 sends, 4 hard bounces → paused; ethan: 25 sends, 0 bounces → fine
  const r = await checkMailboxHealth(NOW, deps);
  expect(r).toEqual({ checked: 2, paused: [{ email: "grace@x.com", reason: "4 hard bounces out of 31 emails in the last 7 days (13%)" }] });
  expect(deps.pause).toHaveBeenCalledWith("G1", "4 hard bounces out of 31 emails in the last 7 days (13%)", new Date(NOW).toISOString());
});
it("a pause another run already made isn't reported twice", async () => { /* pause resolves false → paused: [] */ });
it("without migration 077 it skips and pauses nothing", async () => { /* mailboxes throws Error('column email_accounts.resumed_at does not exist') */ });
```

- [ ] **Step 2: Run** `npx vitest run lib/email/mailbox-health-run.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above (workflow first).
- [ ] **Step 4: Run** `npx vitest run lib/email lib/automation` — Expected: PASS. `npm run typecheck` — clean.
- [ ] **Step 5: Commit** `feat(web): pause a mailbox when its bounces or complaints climb (077)`.

---

### Task 3: A pause is safe: pinned follow-ups wait, replies are still read

**Files:**
- Modify `web/lib/services/email-sender.ts` — new `mailboxStatus(email: string): Promise<string | null>` (the row's
  `status`, null when no such mailbox); in `sendOutreachEmail`, when `getSenderAccount(input.senderEmail)` is null and
  `input.senderEmail` is set and `mailboxStatus` returns a non-null status → `{ sent: false, noop: false, messageId:
  null, reason: "paused" }` (logged `email_sender.mailbox_paused_held`). No mailbox at all keeps today's `noop`.
- Modify `web/lib/pipeline/inbox-sync.ts` — read mailboxes with `status in ('active','paused')` (replies to a paused
  mailbox still stop the lead's emails); header comment updated.
- Test `web/lib/services/email-sender.test.ts` (append; extend the db mock so `maybeSingle` returns rows from a queue
  `mocks.rows` when set, else `mocks.row`)

- [ ] **Step 1: Failing tests**

```ts
it("a follow-up pinned to a paused mailbox waits (held), never counted as sent", async () => {
  mocks.rows = [null, { status: "paused" }]; // getSenderAccount finds no active row; the mailbox exists, paused
  const res = await sendOutreachEmail({ to: "joe@example.com", subject: "s", html: "h", senderEmail: "grace@x.com" });
  expect(res).toEqual({ sent: false, noop: false, messageId: null, reason: "paused" });
  expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
});
it("with no mailbox at all it stays the old dev no-op", async () => {
  mocks.rows = [null, null];
  expect(await sendOutreachEmail({ to: "joe@example.com", subject: "s", html: "h", senderEmail: "gone@x.com" })).toMatchObject({ sent: true, noop: true });
});
```

(Use whatever field names `sendOutreachEmail`'s input already has; the two assertions are the contract.)

- [ ] **Step 2: Run** `npx vitest run lib/services/email-sender.test.ts` — Expected: FAIL on the first test.
- [ ] **Step 3: Implement.** Also check `classifySendOutcome` (sequence-scheduler.ts) already defers `reason: "paused"` — it does; no change.
- [ ] **Step 4: Run** `npx vitest run lib/services lib/pipeline` — Expected: PASS. `npm run typecheck` — clean.
- [ ] **Step 5: Commit** `fix(web): a paused mailbox holds its follow-ups and still reads replies`.

---

### Task 4: Pause / Resume, the Email accounts page, the warning strip, docs

**Files:**
- Create `web/lib/email/mailbox-control.ts` — `setMailboxPaused(id: string, pause: boolean, now?: Date): Promise<{ ok: true; email: string } | { ok: false; status: number; message: string }>`:
  pause → `status 'paused', paused_by 'operator', paused_reason 'Paused by you', paused_at`; resume → `status 'active',
  paused_reason null, paused_by null, paused_at null, resumed_at now`. 404 "Mailbox not found"; 503 "Run database update
  077 first." when the columns are missing.
- Create `web/lib/email/mailbox-paused-load.ts` — `loadAutoPaused(): Promise<{ email: string; reason: string; at: string }[]>`
  (`status='paused'` and `paused_by='auto'`; `[]` on any error).
- Modify `web/app/api/email-accounts/[id]/route.ts` — PATCH also accepts `{ action: "pause" | "resume" }` (zod union with
  the existing `{ daily_cap }`), calls `setMailboxPaused`, `revalidatePath("/email-accounts")`; header updated.
- Create `web/components/MailboxPauseButton.tsx` (client, dumb: Pause / Resume → PATCH → `router.refresh()`, shows the
  refusal text).
- Modify `web/app/(dashboard)/email-accounts/page.tsx` — select also `paused_reason,paused_at,paused_by` (fallback to the
  old select if 077 is missing); a paused row shows the reason, "Paused by the app" / "Paused by you", when, and Resume;
  an active row gets Pause.
- Create `web/components/MailboxPausedBanner.tsx` (server, `noStore()`, like `TestModeBanner`): hidden when
  `loadAutoPaused()` is empty; else one strip: "Sending is paused for <email> (<reason>)" per mailbox + "Check the list,
  then press Resume on Email accounts." linking `/email-accounts`. Modify `web/app/(dashboard)/layout.tsx` to render it
  next to `<TestModeBanner />`.
- Docs: CLAUDE.md (an AUTO-PAUSE paragraph in How the App Works; migration 077 line; latest = 077; API table PATCH
  row), `web/lib/assistant/knowledge.ts` (short entry), `workflows/watch_mailbox_health.md` (the buttons).
- Test `web/lib/email/mailbox-control.test.ts` (inject a db stub): resume clears the reason and stamps `resumed_at`;
  pause sets `paused_by 'operator'`; missing row → 404.

- [ ] **Step 1: Failing tests** (`mailbox-control.test.ts`):

```ts
it("Resume clears the pause and restarts the health window", async () => {
  const r = await setMailboxPaused("G1", false, new Date("2026-12-10T12:00:00Z"), db);
  expect(r).toEqual({ ok: true, email: "grace@x.com" });
  expect(db.patch).toEqual({ status: "active", paused_reason: null, paused_by: null, paused_at: null, resumed_at: "2026-12-10T12:00:00.000Z" });
});
it("Pause by hand is marked as yours", async () => {
  await setMailboxPaused("G1", true, new Date("2026-12-10T12:00:00Z"), db);
  expect(db.patch).toMatchObject({ status: "paused", paused_by: "operator", paused_reason: "Paused by you" });
});
it("an unknown mailbox is 404", async () => {
  expect(await setMailboxPaused("nope", false, new Date(), emptyDb)).toEqual({ ok: false, status: 404, message: "Mailbox not found" });
});
```

(`setMailboxPaused` takes an optional 4th `db` parameter for the stub; default `getDb()`.)

- [ ] **Step 2: Run** `npx vitest run lib/email/mailbox-control.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** `npm test` — Expected: all pass. `npm run typecheck` and `npm run lint` — clean.
- [ ] **Step 5: Commit** `feat(web): pause / resume mailboxes, paused warning on every page`.
