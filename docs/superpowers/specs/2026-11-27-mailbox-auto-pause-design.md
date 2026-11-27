# Mailbox auto-pause — design

Date: 27 Nov 2026 · Source: competitor research, Part IV idea 2 (Explee, 11x: mailbox health monitoring with automatic
pausing) · Project 2 of 3 (after lead score + cost per reply, before AI reply handling).

## Why

Every channel is wasted if our emails land in Spam (QA's test already did). A sending domain's reputation is damaged
by bounces and spam complaints, and it is slow to repair. Today nothing watches each mailbox: a bad list can keep
bouncing from the same address until someone notices. The app should stop a mailbox **by itself** as soon as its
bounces or complaints climb, and leave it stopped until a person has looked.

Success: a mailbox that crosses the limit stops sending within ~15 minutes; the operator sees, on every page, which
mailbox was paused and why ("4 hard bounces out of 31 emails in the last 7 days"), and presses Resume when it's fixed.

## Goals

1. A health check per mailbox, every 15 minutes, in the existing automation tick (Cloud Run `MODE=automation`,
   Cloud Scheduler "automation-tick").
2. Over the limit → the mailbox is set to **paused** with the reason, the time and "paused by the app".
3. **It stays paused until the operator presses Resume** (operator decision, 27 Nov 2026). No automatic resume.
4. The operator sees it: a warning strip on every dashboard page while any mailbox is paused by the app, and the
   reason + Resume on the Email accounts page.

## What pausing must do to the rest of the app (builder check, 27 Nov 2026)

- **New first emails** skip a paused mailbox: every sender already uses only `status = 'active'` mailboxes
  (`lib/services/email-sender.ts`, sequence scheduler rotation, batch email, Send email, the Brain). Unchanged.
- **Follow-ups of leads pinned to the paused mailbox wait until Resume** (my call: same mailbox, same thread; a paused
  mailbox means something is wrong, so nothing moves to another domain behind the operator's back). **Today this is a
  bug that pausing would expose:** `sendOutreachEmail` treats "no active mailbox with that address" as *no mailbox
  connected* (`noop`, counted as sent), so the sequence would silently skip the step and record a fake send. Fix: when
  the pinned mailbox exists but isn't active, return the held result (`reason: "paused"`) so the step waits; only a
  database with no mailbox at all keeps the old dev `noop`.
- **Replies are still read.** `lib/pipeline/inbox-sync.ts` reads only active mailboxes today; it must read paused ones
  too, so a reply / bounce / unsubscribe to a paused mailbox still stops that lead's sequence.
- **All mailboxes paused:** every send waits (held), as with the kill switch.
- Send email (the window) offering a paused mailbox: it isn't listed (active only), unchanged.

## Non-goals

- No change to how mailboxes are picked for first emails.
- No DKIM / DMARC changes (those live in Ongage and DNS).
- No email or Slack alert (the in-app strip only).
- No warm-up changes.

## Anti-goals

- Pausing over noise: one bad address out of five emails must not stop a mailbox. Rates are judged only after enough
  sends.
- A Resume that is undone 15 minutes later by the same old bounces: after Resume, only what happens **after** the
  Resume counts.
- Leaving the operator unaware: a paused mailbox silently holds every send that would have used it.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | One rule in the automation tick, every 15 min, over each mailbox's last 7 days | One place, covers Ongage + inbox bounces, easy to test; up to 15 min late (Ongage reports come every 10 min anyway) |
| B | Check each time a bounce / complaint arrives | Seconds faster, but the check lives in two places (Ongage webhook, inbox sync) |
| C | Check before every send | Never one email too many, but slows every send and must be added at every send point |

Operator picked **A** (27 Nov 2026).

## The rule (my proposal, constants in one pure file so they're easy to change)

Per mailbox, over a **7-day window** that starts no earlier than the mailbox's last Resume:

- **Bounces:** pause when there are **at least 20 emails sent** in the window AND hard bounces are **5% or more** of
  them AND there are **at least 2** hard bounces. Soft bounces don't count (temporary: full inbox, server busy).
- **Spam complaints:** pause at **2 or more** complaints in the window, whatever the number of sends (complaints hurt
  most; Google's bulk-sender limit is 0.3%, which at our volume means almost none).
- The reason is written in plain words, e.g. "4 hard bounces out of 31 emails in the last 7 days (13%)" or
  "2 spam complaints in the last 7 days".

## How a bounce / complaint is matched to a mailbox

Bounces and complaints are recorded on the **lead** (`outreach_events` `email_bounced` with `meta.bounceKind`, and
`email_complaint`, from the Ongage webhook `lib/email/ongage-events.ts` and the inbox reader
`lib/pipeline/inbox-sync.ts`). Every email we send is recorded in `email_messages` (direction `outbound`, status
`sent`, `from_addr` = the mailbox address). A bounce / complaint belongs to the mailbox that sent that lead's **last
email before it**. Emails sent per mailbox = its `email_messages` outbound `sent` rows in the window (every send path writes one:
Send email `lib/email/send-simple.ts`, the sequence tick that also sends batch / Brain emails, stage 5; a held or
Test-mode-blocked send isn't `sent`). My calls: a bounce or complaint with no earlier send we can find is ignored;
each lead counts once per kind in the window (Ongage and the inbox can both report the same bounce); the window is by
the **event time** of the bounce / complaint and of the send; any Resume (after an auto or a manual pause) restarts the
window.

## Storage (migration 077)

`email_accounts`: `paused_reason text`, `paused_at timestamptz`, `paused_by text` (`'auto'` | `'operator'`),
`resumed_at timestamptz`. Code tolerates them missing (the check then does nothing and says so in its summary).
`status` already allows `'paused'`.

## Where the operator sees it

- Anyone using the dashboard can Pause / Resume (the app has no roles).
- **Every dashboard page:** (server-rendered in the dashboard layout like the Test mode banner, one strip listing every
  mailbox the app paused; hidden if the read fails or 077 is missing) a warning strip while any mailbox has `paused_by = 'auto'`: "Sending from
  grace@… is paused: 4 hard bounces out of 31 emails in the last 7 days. Check the list, then Resume on Email
  accounts." (same place as the Test mode banner).
- **Email accounts page:** a paused mailbox shows the reason, when, and by whom, with **Resume**. Active mailboxes get
  **Pause** too (my call: the same switch, useful when the operator spots trouble first; `paused_by = 'operator'`,
  no strip for those).
- Resume sets `status = 'active'`, clears the reason, and stamps `resumed_at`.

## Constraints

- Golden rules (CLAUDE.md): logic in `lib/`, a pure rules file with tests, thin routes, dumb client components,
  required headers, zod at the route.
- Free: no paid calls. Test mode stays on and is unaffected.
- Workflow first: `workflows/watch_mailbox_health.md`; CLAUDE.md, `run_automation.md`, `lib/assistant/knowledge.ts`.

## Left to the builder

Exact wording of the strip; the layout on the Email accounts page; how the queries are batched; whether the check
reads all mailboxes or only active ones (only active ones can be paused).
