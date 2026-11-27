# Watch mailbox health (auto-pause)

Since 27 Nov 2026 · migration 077 · spec `docs/superpowers/specs/2026-11-27-mailbox-auto-pause-design.md` ·
code `web/lib/email/mailbox-health{,-run}.ts`

## What it does

Every 15 minutes (the automation tick, Cloud Run `MODE=automation`, its first part), each **active** sending mailbox
is checked. If its hard bounces or spam complaints climbed, the app **pauses it** and writes why. It **stays paused
until you press Resume**; nothing resumes it on its own.

## The rule

Over the last **7 days**, or since the last Resume when that's later:

| Pause when | Why |
|---|---|
| **2 or more spam complaints** (whatever the number of emails) | Complaints hurt the domain most |
| At least **20 emails** sent, **5% or more** hard bounces, and **at least 2** of them | A bad list; small numbers alone never pause it |

- Soft bounces (full inbox, server busy) don't count.
- A bounce or complaint belongs to the mailbox that sent that lead's last email before it. Each lead counts once,
  even when Ongage and the inbox both report the same bounce.
- After **Resume**, only what happens from then on counts: the old bounces can't pause it again.

The numbers live in one place (`HEALTH` in `web/lib/email/mailbox-health.ts`).

## What a pause does

- No new first emails from it (every sender only uses active mailboxes).
- **Follow-ups of leads whose emails come from it wait** until Resume. They don't move to another mailbox.
- **Replies to it are still read**, so a reply still stops that lead's emails.
- If every mailbox is paused, every email waits.

## Where you see it

- **Every page:** a warning strip naming the mailbox and why, e.g. "Sending is paused for grace@… (4 hard bounces
  out of 31 emails in the last 7 days (13%))".
- **Email accounts:** the reason, when, and whether the app or you paused it, with **Resume**. Active mailboxes have
  **Pause** (paused by you: no warning strip).

## What to do when one is paused

1. Open the leads that bounced or complained (CRM / the lead's timeline): is it one bad batch or list?
2. Fix the cause (stop that batch's emails, check the addresses, check DKIM / DMARC in Ongage).
3. Press **Resume** on Email accounts.

## If something's wrong

| You see | Do |
|---|---|
| The tick summary says "Run database update 077" | Run `db/migrations/077_mailbox_pause.sql` in Supabase |
| A mailbox was paused for a reason you don't agree with | Resume it; the count starts again from that moment |
