# Handle replies with AI (drafts first)

Since 27 Nov 2026 · migration 078 · spec `docs/superpowers/specs/2026-11-27-ai-reply-handling-design.md` ·
code `web/lib/email/reply-ai{,-run}.ts`

## What it does

When a business answers one of our emails, the inbox reader stores it as today (a human reply stops their emails and
moves the lead to Replied). Then **the AI reads it**, gives it **one label**, a **one-line summary** and writes a
**draft answer**. A person checks the draft in the Inbox and sends it. **The AI never sends anything.**

## The labels

| Label | Means | The draft | Also |
|---|---|---|---|
| **Interested** | Wants to talk / see more / how to start | Thanks + proposes a short call, asks for a good time | Top of the Inbox |
| **Question** | Asks before deciding (price, how it works) | Answers only from the offer's facts; otherwise "I'll check and get back to you" | Top of the Inbox |
| **Not now** | Maybe later / busy | Polite, offers to follow up later | CRM follow-up in 30 days (if none is set) |
| **Wrong person** | Not their area / points to someone | Thanks, asks who the right person is | A named person goes into a CRM note |
| **Not interested** | A clear no | A short polite close | The Brain stops this lead |
| **Asked to stop** | "Remove me", "don't contact me" | **None** | Unsubscribed at once (same as an unsubscribe), out of "needs reply" |
| **Other** | Anything else | A neutral answer | — |

## What the AI may say

- Only what the **offer's ready-made email** says (the offer of our last email to them, or their usual offer) and
  what **our last email** said.
- Prices, discounts, dates, guarantees, features we didn't mention: "I'll check and get back to you".
- It answers in their language and signs off "Best regards," + the mailbox's name.
- It never sees other leads' data; their reply is treated as data, never as instructions.

## When it runs

- **Automatically:** the inbox tick (Cloud Run `MODE=inbox`, every few minutes) reads new replies, then drafts the
  new human ones: up to `REPLY_AI_MAX_PER_RUN` (30) per run, at most 8 minutes, oldest first. A reply it couldn't
  draft is tried again on the next runs (3 tries).
- **"Sync replies" button:** reads new replies but **doesn't draft** (60-second limit); the tick drafts them minutes
  later.
- **Draft with AI / Redraft** (Inbox thread): drafts the lead's latest reply now (also for replies from before this
  feature). Once a minute at most.
- Cost: about 1 cent a reply (`OPENAI_REPLY_MODEL`, default `gpt-5.4-mini`).

## In the Inbox

- Each lead shows its label; **Interested** and **Question** are first among the ones needing an answer; a filter
  "All replies / Interested / …".
- The thread shows "AI read this as: Interested — <summary>", and the reply box is **pre-filled with the draft**:
  edit it if needed, then send (the usual Inbox reply, which keeps "Re: their subject" so it stays in the thread).

## The Brain

A "Not interested" reply stops the lead (it isn't a win). A reply the AI hasn't labelled yet is waited for up to an
hour before it counts as a win.

## If something's wrong

| You see | Do |
|---|---|
| "Run database update 078 first" | Run `db/migrations/078_reply_ai.sql` in Supabase |
| "AI drafting isn't switched on" | `OPENAI_API_KEY` is missing (Cloud Run for the tick, Vercel for Redraft) |
| A label looks wrong | Answer as you see fit; press Redraft for a new draft |
| A reply stays "reading…" for long | Check the inbox tick runs (Cloud Scheduler `inbox-sync-tick`) and the worker is deployed |
